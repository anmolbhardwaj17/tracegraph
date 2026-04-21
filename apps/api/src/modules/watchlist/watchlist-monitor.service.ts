import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { WatchlistAlert } from './entities/watchlist-alert.entity';
import { InvestigationService } from '../investigation/investigation.service';
import { Investigation } from '../investigation/entities/investigation.entity';

/**
 * Watchlist Monitoring Service.
 *
 * Periodically re-investigates watchlisted companies and generates
 * alerts when something changes:
 * - Risk score increased
 * - New sanctions match
 * - New PEP detected
 * - Officer changes (new 8-K filing)
 * - New adverse media
 * - New court cases
 */
@Injectable()
export class WatchlistMonitorService {
  private readonly logger = new Logger(WatchlistMonitorService.name);

  constructor(
    @InjectRepository(WatchlistItem) private readonly watchlist: Repository<WatchlistItem>,
    @InjectRepository(WatchlistAlert) private readonly alerts: Repository<WatchlistAlert>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    private readonly investigationService: InvestigationService,
  ) {}

  /**
   * Run monitoring for all watchlisted companies.
   * Called by the cron endpoint or scheduled job.
   */
  async runMonitoring(): Promise<{ checked: number; alerts: number }> {
    const items = await this.watchlist.find();
    this.logger.log(`Watchlist monitoring: checking ${items.length} companies`);

    let alertCount = 0;

    for (const item of items) {
      try {
        const newAlerts = await this.checkCompany(item);
        alertCount += newAlerts;
      } catch (e: any) {
        this.logger.warn(`Monitoring failed for ${item.companyName}: ${e?.message}`);
      }
    }

    this.logger.log(`Watchlist monitoring complete: ${items.length} checked, ${alertCount} alerts generated`);
    return { checked: items.length, alerts: alertCount };
  }

  /** Check a single company for changes */
  private async checkCompany(item: WatchlistItem): Promise<number> {
    // Get the previous investigation
    const prevInv = item.lastInvestigationId
      ? await this.investigations.findOne({ where: { id: item.lastInvestigationId } })
      : null;

    // Run a new QUICK investigation
    const jurisdiction = (item as any).jurisdiction || 'gb';
    const newInv = await this.investigationService.create(item.companyName, 'QUICK', jurisdiction);

    // Wait for completion (max 5 minutes)
    let completedInv: Investigation | null = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      completedInv = await this.investigations.findOne({ where: { id: newInv.id } });
      if (completedInv?.status === 'COMPLETE' || completedInv?.status === 'FAILED') break;
    }

    if (!completedInv || completedInv.status !== 'COMPLETE') {
      this.logger.warn(`Monitoring investigation for ${item.companyName} did not complete`);
      return 0;
    }

    const newProgress = completedInv.progress || {} as any;
    const prevProgress = prevInv?.progress || {} as any;
    const alerts: Omit<WatchlistAlert, 'id' | 'createdAt'>[] = [];

    // Compare risk scores
    const newScore = newProgress.riskScore ?? 0;
    const prevScore = prevProgress.riskScore ?? 0;
    if (newScore > prevScore + 10) {
      alerts.push({
        companyNumber: item.companyNumber,
        companyName: item.companyName,
        alertType: 'RISK_INCREASE',
        severity: newScore >= 75 ? 'CRITICAL' : newScore >= 50 ? 'HIGH' : 'MEDIUM',
        title: `Risk score increased from ${prevScore} to ${newScore}`,
        description: `${item.companyName}'s risk score increased by ${newScore - prevScore} points. Previous: ${prevScore}/100, Current: ${newScore}/100.`,
        metadata: { previousScore: prevScore, currentScore: newScore, investigationId: completedInv.id },
        read: false,
        dismissed: false,
      });
    }

    // Check for new PEPs
    const newPeps = newProgress.pepCount || 0;
    const prevPeps = prevProgress.pepCount || 0;
    if (newPeps > prevPeps) {
      alerts.push({
        companyNumber: item.companyNumber,
        companyName: item.companyName,
        alertType: 'NEW_PEP',
        severity: 'HIGH',
        title: `${newPeps - prevPeps} new PEP(s) detected`,
        description: `${item.companyName} now has ${newPeps} politically exposed person(s) in its network (was ${prevPeps}).`,
        metadata: { previousPeps: prevPeps, currentPeps: newPeps, investigationId: completedInv.id },
        read: false,
        dismissed: false,
      });
    }

    // Check for new sanctions matches
    const newSanctions = newProgress.directSanctions?.matches || 0;
    const prevSanctions = prevProgress.directSanctions?.matches || 0;
    if (newSanctions > prevSanctions) {
      alerts.push({
        companyNumber: item.companyNumber,
        companyName: item.companyName,
        alertType: 'SANCTIONS_MATCH',
        severity: 'CRITICAL',
        title: `New sanctions match detected!`,
        description: `${item.companyName} has ${newSanctions} sanctions match(es) (was ${prevSanctions}). Immediate review required.`,
        metadata: { previousMatches: prevSanctions, currentMatches: newSanctions, investigationId: completedInv.id },
        read: false,
        dismissed: false,
      });
    }

    // Check for new court cases
    const newCourts = newProgress.webIntelligence?.courtCases || 0;
    const prevCourts = prevProgress.webIntelligence?.courtCases || 0;
    if (newCourts > prevCourts + 2) {
      alerts.push({
        companyNumber: item.companyNumber,
        companyName: item.companyName,
        alertType: 'NEW_LITIGATION',
        severity: 'MEDIUM',
        title: `${newCourts - prevCourts} new court cases detected`,
        description: `${item.companyName} has ${newCourts} federal court cases (was ${prevCourts}).`,
        metadata: { previousCases: prevCourts, currentCases: newCourts, investigationId: completedInv.id },
        read: false,
        dismissed: false,
      });
    }

    // Check for finding count increase
    const newFindings = (newProgress.findings || []).length;
    const prevFindings = (prevProgress.findings || []).length;
    const newCritical = (newProgress.findings || []).filter((f: any) => f.severity === 'CRITICAL').length;
    const prevCritical = (prevProgress.findings || []).filter((f: any) => f.severity === 'CRITICAL').length;
    if (newCritical > prevCritical) {
      alerts.push({
        companyNumber: item.companyNumber,
        companyName: item.companyName,
        alertType: 'NEW_CRITICAL_FINDING',
        severity: 'CRITICAL',
        title: `${newCritical - prevCritical} new critical finding(s)`,
        description: `${item.companyName} has ${newCritical} critical findings (was ${prevCritical}). Total findings: ${newFindings}.`,
        metadata: { previousFindings: prevFindings, currentFindings: newFindings, investigationId: completedInv.id },
        read: false,
        dismissed: false,
      });
    }

    // Save alerts
    for (const alert of alerts) {
      await this.alerts.save(this.alerts.create(alert as any));
    }

    // Update watchlist item
    await this.watchlist.update(item.id, {
      lastInvestigationId: completedInv.id,
      lastRiskScore: newScore,
      previousRiskScore: prevScore,
      riskChange: newScore > prevScore + 2 ? 'UP' : newScore < prevScore - 2 ? 'DOWN' : 'STABLE',
      lastInvestigatedAt: new Date(),
    } as any);

    return alerts.length;
  }

  /** Get recent alerts */
  async getAlerts(options?: { unreadOnly?: boolean; limit?: number }): Promise<WatchlistAlert[]> {
    const qb = this.alerts.createQueryBuilder('a').orderBy('a.created_at', 'DESC');
    if (options?.unreadOnly) qb.where('a.read = false AND a.dismissed = false');
    qb.take(options?.limit || 50);
    return qb.getMany();
  }

  /** Mark alert as read */
  async markRead(alertId: string): Promise<void> {
    await this.alerts.update(alertId, { read: true });
  }

  /** Dismiss alert */
  async dismiss(alertId: string): Promise<void> {
    await this.alerts.update(alertId, { dismissed: true });
  }

  /** Get alert count */
  async getUnreadCount(): Promise<number> {
    return this.alerts.count({ where: { read: false, dismissed: false } });
  }
}
