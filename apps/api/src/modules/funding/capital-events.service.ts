import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { FundingEvent, FundingEventType } from './entities/funding-event.entity';
import { Investigation } from '../investigation/entities/investigation.entity';

const CH_BASE = 'https://api.company-information.service.gov.uk';
const SEC_EFTS = 'https://efts.sec.gov/LATEST/search-index';
const USER_AGENT = 'TraceGraph contact@tracegraph.com';

// Filing types that indicate capital events
const CAPITAL_TYPES: Record<string, FundingEventType> = {
  SH01: 'EQUITY_RAISE',      // Return of allotment of shares
  SH02: 'CAPITAL_REDUCTION',  // Notice of consolidation / sub-division
  SH06: 'CAPITAL_REDUCTION',  // Cancellation of shares
  SH08: 'SHARE_CLASS_CHANGE', // Change of share class name/particulars
  SH19: 'CAPITAL_REDUCTION',  // Statement of capital following reduction
  MR01: 'CHARGE_CREATED',     // Mortgage/charge registration
  MR04: 'CHARGE_SATISFIED',   // Mortgage/charge satisfaction
};

@Injectable()
export class CapitalEventsService {
  private readonly logger = new Logger(CapitalEventsService.name);

  constructor(
    @InjectRepository(FundingEvent) private readonly repo: Repository<FundingEvent>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
  ) {}

  /** Fetch and persist capital events for a UK company */
  async ingestUK(
    investigationId: string,
    companyNumber: string,
    companyName: string,
  ): Promise<FundingEvent[]> {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
    if (!apiKey) return [];

    try {
      const res = await axios.get(
        `${CH_BASE}/company/${encodeURIComponent(companyNumber)}/filing-history?category=capital,mortgage&items_per_page=50`,
        {
          auth: { username: apiKey, password: '' },
          timeout: 10000,
        },
      );

      const items: any[] = res.data?.items || [];
      const events: FundingEvent[] = [];

      for (const item of items) {
        const eventType = CAPITAL_TYPES[item.type];
        if (!eventType) continue;

        const event = await this.upsertEvent({
          investigationId,
          companyEntityId: companyNumber,
          companyName,
          eventType,
          eventDate: item.date ? new Date(item.date) : null,
          amountMinor: this.extractAmount(item),
          currency: 'GBP',
          shareClass: this.extractShareClass(item),
          details: {
            filingType: item.type,
            description: item.description,
            descriptionValues: item.description_values,
            transactionId: item.transaction_id,
          },
          source: 'companies-house',
        });
        if (event) events.push(event);
      }

      // Store funding summary in investigation.progress for Tracey/memo context
      if (events.length > 0) await this.persistSummary(investigationId, events);

      this.logger.log(`UK capital events for ${companyNumber}: ${events.length} events ingested`);
      return events;
    } catch (e: any) {
      this.logger.warn(`CH capital events failed for ${companyNumber}: ${e?.message}`);
      return [];
    }
  }

  /** Fetch and persist Form D SEC private placements for a US company */
  async ingestFormD(
    investigationId: string,
    cik: string,
    companyName: string,
  ): Promise<FundingEvent[]> {
    try {
      const res = await axios.get(SEC_EFTS, {
        params: { q: `"${companyName}"`, forms: 'D', dateRange: 'custom', startdt: '2010-01-01' },
        headers: { 'User-Agent': USER_AGENT },
        timeout: 10000,
      });

      const hits = res.data?.hits?.hits || [];
      const events: FundingEvent[] = [];

      for (const hit of hits.slice(0, 10)) {
        const src = hit._source || {};
        if (!src.period_of_report) continue;

        const event = await this.upsertEvent({
          investigationId,
          companyEntityId: cik,
          companyName,
          eventType: 'FORM_D_RAISE',
          eventDate: src.period_of_report ? new Date(src.period_of_report) : null,
          amountMinor: src.totalAmountSold ? Math.round(parseFloat(src.totalAmountSold) * 100) : null,
          currency: 'USD',
          shareClass: src.securityType || null,
          details: {
            formType: 'D',
            exemptionType: src.exemptionType,
            totalOffering: src.totalOfferingAmount,
            amountSold: src.totalAmountSold,
            investors: src.numberPurchasers,
            accessionNumber: src.accession_no,
            url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=D&dateb=&owner=include&count=40`,
          },
          source: 'sec-edgar-form-d',
        });
        if (event) events.push(event);
      }

      if (events.length > 0) await this.persistSummary(investigationId, events);
      return events;
    } catch (e: any) {
      this.logger.warn(`SEC Form D failed for ${cik}: ${e?.message}`);
      return [];
    }
  }

  private async persistSummary(investigationId: string, events: FundingEvent[]): Promise<void> {
    try {
      const inv = await this.investigations.findOne({ where: { id: investigationId } });
      if (!inv) return;

      const equityEvents = events.filter((e) => e.eventType === 'EQUITY_RAISE' || e.eventType === 'FORM_D_RAISE');
      const totalRaised = equityEvents.reduce((sum, e) => sum + (e.amountMinor || 0), 0);
      const latestEquity = equityEvents[0];

      const summary = {
        totalEvents: events.length,
        equityRaises: equityEvents.length,
        totalRaisedMinor: totalRaised,
        currency: latestEquity?.currency || 'GBP',
        latestRaise: latestEquity
          ? { date: latestEquity.eventDate, amount: latestEquity.amountMinor, shareClass: latestEquity.shareClass }
          : null,
        events: events.slice(0, 10).map((e) => ({
          type: e.eventType,
          date: e.eventDate,
          amount: e.amountMinor,
          currency: e.currency,
          shareClass: e.shareClass,
          source: e.source,
        })),
      };

      await this.investigations.update(investigationId, {
        progress: { ...(inv.progress || {}), fundingEvents: summary } as any,
      } as any);
    } catch (e: any) {
      this.logger.warn(`persistSummary failed: ${e?.message}`);
    }
  }

  /** Fetch all funding events for an investigation */
  async getForInvestigation(investigationId: string): Promise<FundingEvent[]> {
    return this.repo.find({
      where: { investigationId },
      order: { eventDate: 'DESC' },
    });
  }

  /** Get all funding events for a company across all investigations */
  async getForCompany(companyEntityId: string): Promise<FundingEvent[]> {
    return this.repo.find({
      where: { companyEntityId },
      order: { eventDate: 'DESC' },
    });
  }

  private async upsertEvent(data: Partial<FundingEvent>): Promise<FundingEvent | null> {
    try {
      const entity: FundingEvent = this.repo.create(data as FundingEvent);
      return await this.repo.save(entity);
    } catch (e: any) {
      if (e?.code === '23505') return null; // unique violation = already exists
      throw e;
    }
  }

  private extractAmount(item: any): number | null {
    const dv = item.description_values;
    if (!dv) return null;

    // SH01 capital array: [{ figure, currency }]
    if (dv.capital && Array.isArray(dv.capital)) {
      const total = dv.capital.reduce((sum: number, c: any) => {
        const fig = parseFloat(String(c.figure || '0').replace(/,/g, ''));
        return sum + (isNaN(fig) ? 0 : fig);
      }, 0);
      return total > 0 ? Math.round(total * 100) : null; // store in pence
    }

    // MR01 amount secured
    if (dv.amount_secured) {
      const fig = parseFloat(String(dv.amount_secured).replace(/[^0-9.]/g, ''));
      return isNaN(fig) ? null : Math.round(fig * 100);
    }

    return null;
  }

  private extractShareClass(item: any): string | null {
    const dv = item.description_values;
    if (!dv) return null;
    if (dv.capital && Array.isArray(dv.capital)) {
      return dv.capital.map((c: any) => c.share_type || c.type).filter(Boolean).join(', ') || null;
    }
    return dv.share_type || dv.shareType || null;
  }
}
