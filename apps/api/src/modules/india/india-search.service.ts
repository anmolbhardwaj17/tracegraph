import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IndiaCompany } from './india-company.entity';

/**
 * India Company Search Service.
 *
 * Searches the local india_companies table (bulk-imported MCA data)
 * for instant results. Falls back to NSE/Wikidata if table is empty.
 *
 * Provides:
 * - Full-text search by company name
 * - Fuzzy matching via trigram similarity
 * - CIN lookup
 * - State/status filtering
 */
@Injectable()
export class IndiaSearchService {
  private readonly logger = new Logger(IndiaSearchService.name);
  private tableExists: boolean | null = null;

  constructor(
    @InjectRepository(IndiaCompany) private readonly repo: Repository<IndiaCompany>,
  ) {}

  /** Check if india_companies table has data */
  async isAvailable(): Promise<boolean> {
    if (this.tableExists != null) return this.tableExists;
    try {
      const count = await this.repo.count();
      this.tableExists = count > 0;
      if (this.tableExists) this.logger.log(`India company database: ${count.toLocaleString()} companies loaded`);
      return this.tableExists;
    } catch {
      this.tableExists = false;
      return false;
    }
  }

  /** Search companies by name (fuzzy) */
  async search(query: string, limit = 20): Promise<IndiaCompany[]> {
    if (!(await this.isAvailable())) return [];

    try {
      // Try trigram similarity first (fuzzy match)
      const results = await this.repo
        .createQueryBuilder('c')
        .where(`c.company_name ILIKE :pattern`, { pattern: `%${query}%` })
        .orderBy(`similarity(c.company_name, :query)`, 'DESC')
        .setParameter('query', query)
        .take(limit)
        .getMany();

      return results;
    } catch {
      // Fallback to simple ILIKE if trigram extension not available
      return this.repo
        .createQueryBuilder('c')
        .where(`c.company_name ILIKE :pattern`, { pattern: `%${query}%` })
        .orderBy('c.paid_up_capital', 'DESC', 'NULLS LAST')
        .take(limit)
        .getMany();
    }
  }

  /** Lookup by CIN */
  async getByCin(cin: string): Promise<IndiaCompany | null> {
    if (!(await this.isAvailable())) return null;
    return this.repo.findOne({ where: { cin } });
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
    if (!(await this.isAvailable())) return null;

    // Try CIN first
    let company = await this.repo.findOne({ where: { cin: cinOrName } });

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
}
