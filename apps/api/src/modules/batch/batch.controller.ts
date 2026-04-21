import { Controller, Post, Get, Body, Param, BadRequestException } from '@nestjs/common';
import { BatchService, BatchCompany } from './batch.service';

@Controller('batch')
export class BatchController {
  constructor(private readonly batchService: BatchService) {}

  /**
   * POST /api/batch
   * Create a batch screening job.
   *
   * Body: { companies: [{name: "Apple Inc"}, ...], tier?: "QUICK", jurisdiction?: "us", name?: "Q1 Vendor Screen" }
   * Or: { companies: ["Apple Inc", "Google", ...] } — simple string array
   */
  @Post()
  async create(@Body() body: any) {
    let companies: BatchCompany[] = [];

    if (Array.isArray(body.companies)) {
      companies = body.companies.map((c: any) => {
        if (typeof c === 'string') return { name: c };
        return { name: c.name, jurisdiction: c.jurisdiction };
      });
    } else if (typeof body.csv === 'string') {
      // Parse CSV: one company per line, optional jurisdiction column
      companies = body.csv
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0 && !line.toLowerCase().startsWith('company'))
        .map((line: string) => {
          const parts = line.split(',').map((s: string) => s.trim().replace(/"/g, ''));
          return { name: parts[0], jurisdiction: parts[1] || undefined };
        });
    }

    if (companies.length === 0) {
      throw new BadRequestException('No companies provided. Send { companies: [...] } or { csv: "..." }');
    }
    if (companies.length > 500) {
      throw new BadRequestException('Maximum 500 companies per batch');
    }

    return this.batchService.create(companies, {
      name: body.name,
      tier: body.tier,
      jurisdiction: body.jurisdiction,
    });
  }

  /** GET /api/batch — list all batches */
  @Get()
  async list() {
    return this.batchService.list();
  }

  /** GET /api/batch/:id — get batch status + results */
  @Get(':id')
  async get(@Param('id') id: string) {
    const result = await this.batchService.get(id);
    if (!result) throw new BadRequestException('Batch not found');
    return result;
  }
}
