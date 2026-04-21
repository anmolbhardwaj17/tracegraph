import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BatchScreen } from './entities/batch-screen.entity';
import { InvestigationService } from '../investigation/investigation.service';
import { Investigation } from '../investigation/entities/investigation.entity';

export interface BatchCompany {
  name: string;
  jurisdiction?: string;
}

@Injectable()
export class BatchService {
  private readonly logger = new Logger(BatchService.name);

  constructor(
    @InjectRepository(BatchScreen) private readonly batches: Repository<BatchScreen>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    private readonly investigationService: InvestigationService,
  ) {}

  /**
   * Create a batch screening job. Queues investigations for each company.
   * Uses QUICK tier by default for speed.
   */
  async create(
    companies: BatchCompany[],
    options?: { name?: string; tier?: 'QUICK' | 'STANDARD' | 'DEEP'; jurisdiction?: string },
  ): Promise<BatchScreen> {
    const tier = options?.tier || 'QUICK';
    const defaultJurisdiction = options?.jurisdiction || 'us';

    const batch = await this.batches.save(this.batches.create({
      name: options?.name || `Batch ${new Date().toISOString().split('T')[0]}`,
      status: 'RUNNING',
      tier,
      jurisdiction: defaultJurisdiction,
      totalCompanies: companies.length,
      investigationIds: [],
      results: [],
    }));

    this.logger.log(`Batch ${batch.id} created: ${companies.length} companies, tier=${tier}`);

    // Queue all investigations (BullMQ handles concurrency)
    const investigationIds: string[] = [];
    for (const company of companies) {
      try {
        const inv = await this.investigationService.create(
          company.name,
          tier,
          company.jurisdiction || defaultJurisdiction,
        );
        investigationIds.push(inv.id);
      } catch (e: any) {
        this.logger.warn(`Failed to queue ${company.name}: ${e?.message}`);
      }
    }

    await this.batches.update(batch.id, { investigationIds });

    // Start polling for completion in the background
    this.pollCompletion(batch.id, investigationIds).catch(() => {});

    return { ...batch, investigationIds };
  }

  /** Get batch status and results */
  async get(id: string): Promise<any> {
    const batch = await this.batches.findOne({ where: { id } });
    if (!batch) return null;

    // Get current status of all investigations
    const results: any[] = [];
    let completed = 0;
    let failed = 0;

    for (const invId of batch.investigationIds || []) {
      const inv = await this.investigations.findOne({ where: { id: invId } });
      if (!inv) continue;

      if (inv.status === 'COMPLETE') {
        completed++;
        results.push({
          investigationId: inv.id,
          companyName: inv.metadata?.companyName || inv.query,
          status: inv.status,
          riskScore: inv.progress?.riskScore ?? 0,
          riskClassification: inv.progress?.riskScore >= 75 ? 'CRITICAL' : inv.progress?.riskScore >= 50 ? 'HIGH' : inv.progress?.riskScore >= 25 ? 'MEDIUM' : 'LOW',
          findings: (inv.progress?.findings || []).length,
          pepCount: inv.progress?.pepCount || 0,
          sanctionsMatch: (inv.progress?.directSanctions?.matches || 0) > 0,
          adverseMedia: inv.progress?.adverseMediaCount || 0,
        });
      } else if (inv.status === 'FAILED') {
        failed++;
        results.push({
          investigationId: inv.id,
          companyName: inv.metadata?.companyName || inv.query,
          status: 'FAILED',
          error: inv.metadata?.error,
          riskScore: null,
        });
      } else {
        results.push({
          investigationId: inv.id,
          companyName: inv.metadata?.companyName || inv.query,
          status: inv.status,
          riskScore: null,
        });
      }
    }

    // Sort by risk score (highest first)
    results.sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1));

    const isComplete = completed + failed >= batch.totalCompanies;

    return {
      id: batch.id,
      name: batch.name,
      status: isComplete ? 'COMPLETE' : 'RUNNING',
      tier: batch.tier,
      jurisdiction: batch.jurisdiction,
      totalCompanies: batch.totalCompanies,
      completed,
      failed,
      pending: batch.totalCompanies - completed - failed,
      results,
      summary: isComplete ? this.generateSummary(results) : null,
      createdAt: batch.createdAt,
      completedAt: isComplete ? new Date() : null,
    };
  }

  /** List all batches */
  async list(): Promise<any[]> {
    const batches = await this.batches.find({ order: { createdAt: 'DESC' }, take: 20 });
    return batches.map((b) => ({
      id: b.id,
      name: b.name,
      status: b.status,
      totalCompanies: b.totalCompanies,
      completed: b.completed,
      failed: b.failed,
      createdAt: b.createdAt,
    }));
  }

  /** Background polling — checks if all investigations in a batch are done */
  private async pollCompletion(batchId: string, investigationIds: string[]): Promise<void> {
    const maxPolls = 300; // 5min max polling (1s interval)
    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, 10000)); // check every 10s

      let completed = 0;
      let failed = 0;
      const results: any[] = [];

      for (const invId of investigationIds) {
        const inv = await this.investigations.findOne({ where: { id: invId } });
        if (!inv) { failed++; continue; }
        if (inv.status === 'COMPLETE') {
          completed++;
          results.push({
            investigationId: inv.id,
            companyName: inv.metadata?.companyName || inv.query,
            riskScore: inv.progress?.riskScore ?? 0,
          });
        } else if (inv.status === 'FAILED') {
          failed++;
        }
      }

      await this.batches.update(batchId, { completed, failed });

      if (completed + failed >= investigationIds.length) {
        await this.batches.update(batchId, {
          status: 'COMPLETE',
          completed,
          failed,
          results,
          completedAt: new Date(),
        });
        this.logger.log(`Batch ${batchId} COMPLETE: ${completed} done, ${failed} failed`);
        return;
      }
    }

    // Timed out
    await this.batches.update(batchId, { status: 'COMPLETE' });
    this.logger.warn(`Batch ${batchId} polling timed out`);
  }

  private generateSummary(results: any[]): any {
    const completed = results.filter((r) => r.status === 'COMPLETE');
    const scores = completed.map((r) => r.riskScore).filter((s): s is number => s != null);
    return {
      totalScreened: completed.length,
      averageScore: scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0,
      critical: completed.filter((r) => r.riskClassification === 'CRITICAL').length,
      high: completed.filter((r) => r.riskClassification === 'HIGH').length,
      medium: completed.filter((r) => r.riskClassification === 'MEDIUM').length,
      low: completed.filter((r) => r.riskClassification === 'LOW').length,
      withPep: completed.filter((r) => r.pepCount > 0).length,
      withSanctions: completed.filter((r) => r.sanctionsMatch).length,
    };
  }
}
