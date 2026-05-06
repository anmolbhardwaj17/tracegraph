import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, IsNull, Or } from 'typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { WatchlistAlert } from './entities/watchlist-alert.entity';
import { WatchlistMonitorService } from './watchlist-monitor.service';
import { EmailService } from '../notifications/email.service';

const FREQUENCY_DAYS: Record<string, number> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 30,
  MANUAL: Infinity,
};

@Injectable()
export class WatchlistSchedulerService {
  private readonly logger = new Logger(WatchlistSchedulerService.name);

  constructor(
    @InjectRepository(WatchlistItem) private readonly watchlist: Repository<WatchlistItem>,
    @InjectRepository(WatchlistAlert) private readonly alerts: Repository<WatchlistAlert>,
    private readonly monitor: WatchlistMonitorService,
    private readonly email: EmailService,
  ) {}

  /** Daily at 02:00 UTC — check all items due for re-check */
  @Cron('0 2 * * *')
  async runScheduledChecks(): Promise<void> {
    this.logger.log('Scheduled watchlist check starting...');

    const now = new Date();
    const items = await this.watchlist.find();
    const due = items.filter((item) => this.isDue(item, now));

    this.logger.log(`${due.length} of ${items.length} watchlist items are due for re-check`);

    // Track alerts generated per user email (for digest)
    const alertsByEmail = new Map<string, any[]>();

    for (const item of due) {
      try {
        const beforeCount = await this.alerts.count({ where: { companyNumber: item.companyNumber, read: false, dismissed: false } });
        await this.runSingleCheck(item);
        const afterCount = await this.alerts.count({ where: { companyNumber: item.companyNumber, read: false, dismissed: false } });

        if (afterCount > beforeCount) {
          // Fetch newly generated alerts
          const newAlerts = await this.alerts.find({
            where: { companyNumber: item.companyNumber, read: false, dismissed: false },
            order: { createdAt: 'DESC' },
            take: afterCount - beforeCount,
          });

          // Get user email from investigation metadata if available
          const userEmail = process.env.ADMIN_ALERT_EMAIL;
          if (userEmail) {
            const existing = alertsByEmail.get(userEmail) || [];
            alertsByEmail.set(userEmail, [...existing, ...newAlerts]);

            // Send immediate email for CRITICAL alerts
            for (const alert of newAlerts) {
              if (alert.severity === 'CRITICAL' && alert.metadata?.investigationId) {
                await this.email.sendImmediateAlert(userEmail, alert, alert.metadata.investigationId);
              }
            }
          }
        }

        // Update next check time
        await this.updateNextCheck(item);
      } catch (e: any) {
        this.logger.warn(`Scheduled check failed for ${item.companyName}: ${e?.message}`);
      }
    }

    // Send daily digest for non-critical new alerts
    for (const [emailAddr, newAlerts] of alertsByEmail) {
      const nonCritical = newAlerts.filter((a) => a.severity !== 'CRITICAL');
      if (nonCritical.length > 0) {
        await this.email.sendAlertDigest(emailAddr, nonCritical);
      }
    }

    this.logger.log(`Scheduled watchlist check complete. Checked: ${due.length}`);
  }

  /** Manually trigger a check for a specific item */
  async triggerCheck(companyNumber: string): Promise<{ alerts: number }> {
    const item = await this.watchlist.findOne({ where: { companyNumber } });
    if (!item) return { alerts: 0 };
    const count = await this.runSingleCheck(item);
    await this.updateNextCheck(item);
    return { alerts: count };
  }

  private async runSingleCheck(item: WatchlistItem): Promise<number> {
    return this.monitor.checkCompanyPublic(item);
  }

  private isDue(item: WatchlistItem, now: Date): boolean {
    if (item.checkFrequency === 'MANUAL') return false;
    if (!item.nextCheckAt) return true; // never checked — due immediately
    return item.nextCheckAt <= now;
  }

  private async updateNextCheck(item: WatchlistItem): Promise<void> {
    const days = FREQUENCY_DAYS[item.checkFrequency] || 7;
    if (days === Infinity) return;
    const nextCheck = new Date();
    nextCheck.setDate(nextCheck.getDate() + days);
    await this.watchlist.update(item.id, { nextCheckAt: nextCheck, lastInvestigatedAt: new Date() } as any);
  }
}
