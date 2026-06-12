import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';

@Injectable()
export class WatchlistService {
  constructor(
    @InjectRepository(WatchlistItem) private readonly repo: Repository<WatchlistItem>,
  ) {}

  async list(): Promise<WatchlistItem[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } }) as any;
  }

  async add(companyNumber: string, companyName: string, investigationId?: string, riskScore?: number): Promise<any> {
    const existing = await this.repo.findOne({ where: { companyNumber } });
    if (existing) {
      if (investigationId) existing.lastInvestigationId = investigationId;
      if (riskScore != null) existing.lastRiskScore = riskScore;
      existing.lastInvestigatedAt = new Date();
      return this.repo.save(existing);
    }
    return this.repo.save(
      this.repo.create({
        companyNumber,
        companyName,
        lastInvestigationId: investigationId,
        lastRiskScore: riskScore ?? null,
        lastInvestigatedAt: investigationId ? new Date() : null,
      } as any),
    );
  }

  async remove(companyNumber: string): Promise<void> {
    const item = await this.repo.findOne({ where: { companyNumber } });
    if (!item) throw new NotFoundException('Company not on watchlist');
    await this.repo.remove(item);
  }

  async setFrequency(companyNumber: string, frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'MANUAL'): Promise<void> {
    await this.repo.update({ companyNumber }, { checkFrequency: frequency } as any);
  }

  async updateAfterInvestigation(companyNumber: string, investigationId: string, riskScore: number): Promise<void> {
    const item = await this.repo.findOne({ where: { companyNumber } });
    if (!item) return;
    // Track score change
    if (item.lastRiskScore != null) {
      item.previousRiskScore = item.lastRiskScore;
      const delta = riskScore - item.lastRiskScore;
      item.riskChange = delta > 2 ? 'UP' : delta < -2 ? 'DOWN' : 'STABLE';
    }
    item.lastInvestigationId = investigationId;
    item.lastRiskScore = riskScore;
    item.lastInvestigatedAt = new Date();
    await this.repo.save(item);
  }
}
