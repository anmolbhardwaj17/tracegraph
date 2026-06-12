import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not } from 'typeorm';
import { Investigation, DealStage, DealPriority } from '../investigation/entities/investigation.entity';
import { InvestigationNote } from './entities/investigation-note.entity';
import { InvestigationActivity } from './entities/investigation-activity.entity';

const STAGE_ORDER: DealStage[] = ['TARGETING', 'INITIAL_SCREEN', 'MEETING', 'DD', 'IOI', 'LOI', 'CLOSING', 'CLOSED_WON', 'CLOSED_LOST'];

@Injectable()
export class PipelineService {
  constructor(
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    @InjectRepository(InvestigationNote) private readonly notes: Repository<InvestigationNote>,
    @InjectRepository(InvestigationActivity) private readonly activity: Repository<InvestigationActivity>,
  ) {}

  /** List all pipeline cards (investigations with a deal_stage set) */
  async listPipeline(filters: { stage?: string; priority?: string; owner?: string }) {
    const qb = this.investigations
      .createQueryBuilder('i')
      .where('i.deal_stage IS NOT NULL')
      .orderBy('i.created_at', 'DESC');

    if (filters.stage) qb.andWhere('i.deal_stage = :stage', { stage: filters.stage });
    if (filters.priority) qb.andWhere('i.deal_priority = :priority', { priority: filters.priority });
    if (filters.owner) qb.andWhere('i.deal_owner_name ILIKE :owner', { owner: `%${filters.owner}%` });

    const items = await qb.getMany();
    return items.map((inv) => this.toCard(inv));
  }

  /** Get kanban grouped by stage */
  async kanban() {
    const items = await this.investigations.find({
      where: { dealStage: Not(IsNull()) as any },
      order: { createdAt: 'DESC' },
    });
    const columns: Record<string, any[]> = {};
    for (const stage of STAGE_ORDER) columns[stage] = [];
    for (const inv of items) {
      const stage = inv.dealStage || 'TARGETING';
      if (!columns[stage]) columns[stage] = [];
      columns[stage].push(this.toCard(inv));
    }
    return { columns, stageOrder: STAGE_ORDER };
  }

  /** Pipeline funnel stats */
  async stats() {
    const all = await this.investigations.find({
      where: { dealStage: Not(IsNull()) as any },
    });
    const byStage = STAGE_ORDER.reduce((acc, s) => ({ ...acc, [s]: 0 }), {} as Record<string, number>);
    for (const inv of all) byStage[inv.dealStage || 'TARGETING']++;
    const stale = all.filter((inv) => {
      const daysSince = (Date.now() - new Date(inv.createdAt).getTime()) / 86400000;
      return daysSince > 30 && inv.dealStage !== 'CLOSED_WON' && inv.dealStage !== 'CLOSED_LOST';
    });
    return {
      total: all.length,
      byStage,
      staleCount: stale.length,
      wonCount: byStage['CLOSED_WON'] || 0,
      lostCount: byStage['CLOSED_LOST'] || 0,
    };
  }

  /** Update deal stage */
  async updateStage(id: string, stage: DealStage, actorName?: string) {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return null;
    const prev = inv.dealStage;
    await this.investigations.update(id, { dealStage: stage });
    await this.logActivity(id, 'STAGE_CHANGE', { from: prev, to: stage }, actorName);
    return { id, dealStage: stage };
  }

  /** Update deal priority */
  async updatePriority(id: string, priority: DealPriority, actorName?: string) {
    await this.investigations.update(id, { dealPriority: priority });
    await this.logActivity(id, 'PRIORITY_CHANGE', { priority }, actorName);
    return { id, dealPriority: priority };
  }

  /** Update deal size estimate */
  async updateDealSize(id: string, sizeEstimate: number, actorName?: string) {
    await this.investigations.update(id, { dealSizeEstimate: sizeEstimate });
    await this.logActivity(id, 'DEAL_SIZE_SET', { sizeEstimate }, actorName);
    return { id, dealSizeEstimate: sizeEstimate };
  }

  /** Update deal owner */
  async updateOwner(id: string, ownerName: string, actorName?: string) {
    await this.investigations.update(id, { dealOwnerName: ownerName });
    await this.logActivity(id, 'OWNER_CHANGE', { ownerName }, actorName);
    return { id, dealOwnerName: ownerName };
  }

  /** Add a note to an investigation */
  async addNote(investigationId: string, body: string, authorName?: string) {
    const note = await this.notes.save(
      this.notes.create({ investigationId, body, authorName: authorName || null }),
    );
    await this.logActivity(investigationId, 'NOTE_ADDED', { noteId: note.id }, authorName);
    return note;
  }

  /** Get notes for an investigation */
  async getNotes(investigationId: string) {
    return this.notes.find({ where: { investigationId }, order: { createdAt: 'DESC' } });
  }

  /** Get activity log for an investigation */
  async getActivity(investigationId: string) {
    return this.activity.find({ where: { investigationId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  /** Get full deal detail for a single investigation */
  async getDealDetail(id: string) {
    const inv = await this.investigations.findOne({ where: { id } });
    if (!inv) return null;
    const [notes, activityLog] = await Promise.all([
      this.getNotes(id),
      this.getActivity(id),
    ]);
    return { ...this.toCard(inv), notes, activity: activityLog };
  }

  private toCard(inv: Investigation) {
    const progress = inv.progress || {} as any;
    return {
      id: inv.id,
      companyName: inv.metadata?.companyName || inv.query,
      query: inv.query,
      status: inv.status,
      tier: inv.tier,
      createdAt: inv.createdAt,
      completedAt: inv.completedAt,
      riskScore: progress.riskScore ?? null,
      riskClassification: progress.riskClassification ?? null,
      dealStage: inv.dealStage,
      dealPriority: inv.dealPriority,
      dealSizeEstimate: inv.dealSizeEstimate,
      dealOwnerName: inv.dealOwnerName,
      entityCount: progress.entitiesDiscovered ?? null,
    };
  }

  private async logActivity(investigationId: string, action: string, payload: any, actorName?: string) {
    await this.activity.save(
      this.activity.create({ investigationId, action, payload, actorName: actorName || null }),
    );
  }
}
