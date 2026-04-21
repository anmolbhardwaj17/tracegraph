import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IndiaCompany } from './india-company.entity';

/**
 * India Company Search Service.
 *
 * Searches the local india_companies table for instant results.
 * Auto-populates: when a company is discovered via NSE/Tofler/Wikidata
 * during an investigation, it's saved to the local DB for future searches.
 *
 * Over time the DB grows organically — every investigated company
 * becomes searchable locally without API calls.
 */
@Injectable()
export class IndiaSearchService {
  private readonly logger = new Logger(IndiaSearchService.name);

  constructor(
    @InjectRepository(IndiaCompany) private readonly repo: Repository<IndiaCompany>,
  ) {}

  /** Search companies by name (fuzzy) */
  async search(query: string, limit = 20): Promise<IndiaCompany[]> {
    try {
      const results = await this.repo
        .createQueryBuilder('c')
        .where(`c.company_name ILIKE :pattern`, { pattern: `%${query}%` })
        .orderBy('c.paid_up_capital', 'DESC', 'NULLS LAST')
        .take(limit)
        .getMany();
      return results;
    } catch {
      return [];
    }
  }

  /** Lookup by CIN */
  async getByCin(cin: string): Promise<IndiaCompany | null> {
    try {
      return this.repo.findOne({ where: { cin } });
    } catch {
      return null;
    }
  }

  /**
   * Auto-populate: save a company discovered during investigation.
   * Called by the investigation processor after NSE/Tofler/Wikidata finds a company.
   * Upserts — updates existing records, inserts new ones.
   */
  async saveDiscovered(data: {
    cin: string;
    companyName: string;
    status?: string;
    companyType?: string;
    category?: string;
    dateOfRegistration?: string | null;
    authorizedCapital?: number | null;
    paidUpCapital?: number | null;
    state?: string;
    registeredAddress?: string;
    email?: string;
    listedStatus?: string;
    activityDescription?: string;
  }): Promise<void> {
    if (!data.cin || !data.companyName) return;
    try {
      await this.repo.query(
        `INSERT INTO india_companies (cin, company_name, status, company_type, category, date_of_registration, authorized_capital, paid_up_capital, state, registered_address, email, listed_status, activity_description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (cin) DO UPDATE SET
           company_name = COALESCE(EXCLUDED.company_name, india_companies.company_name),
           status = COALESCE(EXCLUDED.status, india_companies.status),
           company_type = COALESCE(EXCLUDED.company_type, india_companies.company_type),
           registered_address = COALESCE(EXCLUDED.registered_address, india_companies.registered_address),
           listed_status = COALESCE(EXCLUDED.listed_status, india_companies.listed_status),
           activity_description = COALESCE(EXCLUDED.activity_description, india_companies.activity_description)`,
        [
          data.cin, data.companyName, data.status || null, data.companyType || null,
          data.category || null, data.dateOfRegistration || null,
          data.authorizedCapital || null, data.paidUpCapital || null,
          data.state || null, data.registeredAddress || null,
          data.email || null, data.listedStatus || null, data.activityDescription || null,
        ],
      );
      this.logger.log(`India DB auto-populated: ${data.companyName} (${data.cin})`);
    } catch (e: any) {
      this.logger.warn(`India DB save failed for ${data.cin}: ${e?.message}`);
    }
  }

  /** Get company profile for investigation */
  async getProfile(cinOrName: string): Promise<{
    cin: string;
    name: string;
    status: string;
    type: string | null;
    category: string | null;
    registeredDate: string | null;
    capital: number | null;
    state: string | null;
    address: string | null;
    listed: boolean;
    activityDescription: string | null;
  } | null> {
    // Try CIN first
    let company = await this.getByCin(cinOrName);

    // Fallback to name search
    if (!company) {
      const results = await this.search(cinOrName, 1);
      company = results[0] || null;
    }

    if (!company) return null;

    return {
      cin: company.cin,
      name: company.companyName,
      status: company.status || 'unknown',
      type: company.companyType,
      category: company.category,
      registeredDate: company.dateOfRegistration?.toISOString().split('T')[0] || null,
      capital: company.paidUpCapital ? Number(company.paidUpCapital) : null,
      state: company.state,
      address: company.registeredAddress,
      listed: company.listedStatus === 'Listed',
      activityDescription: company.activityDescription,
    };
  }

  /** Get total count for stats */
  async count(): Promise<number> {
    try { return this.repo.count(); } catch { return 0; }
  }
}
