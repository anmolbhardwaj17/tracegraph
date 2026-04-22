import { Public } from '../auth/guards/jwt-auth.guard';
import { Controller, Get, Query } from '@nestjs/common';
import { CompaniesHouseService } from './companies-house.service';

@Public()
@Controller('companies-house')
export class CompaniesHouseController {
  constructor(private readonly ch: CompaniesHouseService) {}

  @Get('search')
  async search(@Query('q') q: string) {
    if (!q || q.trim().length < 2) return { items: [] };
    try {
      const result = await this.ch.searchCompanies(q.trim());
      return {
        items: (result?.items || []).slice(0, 10).map((it: any) => ({
          companyNumber: it.company_number,
          title: it.title,
          status: it.company_status,
          address: it.address_snippet,
          incorporated: it.date_of_creation,
        })),
      };
    } catch (e: any) {
      return { items: [], error: e?.message || 'search failed' };
    }
  }
}
