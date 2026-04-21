import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InvestigationService } from './investigation.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { ReportService } from '../report/report.service';

@ApiTags('Investigations')
@Controller('investigations')
export class InvestigationController {
  constructor(
    private readonly service: InvestigationService,
    private readonly reports: ReportService,
  ) {}

  @Post()
  async create(@Body() dto: CreateInvestigationDto) {
    const inv = await this.service.create(dto.query, dto.tier || 'STANDARD', dto.jurisdiction || 'gb');
    return { id: inv.id, status: inv.status, tier: inv.tier };
  }

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('risk') risk?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.listPaginated({
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '25', 10), 100),
      risk: risk as any,
      status: status as any,
      search,
      from,
      to,
    });
  }

  @Get('stats')
  async stats() {
    return this.service.stats();
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/meta')
  async meta(@Param('id') id: string) {
    return this.service.getMeta(id);
  }

  @Get(':id/overview')
  async overview(@Param('id') id: string) {
    return this.service.getOverview(id);
  }

  @Get(':id/graph')
  async graph(@Param('id') id: string) {
    return this.service.graphFor(id);
  }

  @Get(':id/findings')
  async findings(@Param('id') id: string) {
    return this.service.getFindings(id);
  }

  @Get(':id/entities')
  async entities(@Param('id') id: string, @Query('type') type?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getEntities(id, type, parseInt(page || '1', 10), Math.min(parseInt(limit || '50', 10), 200));
  }

  @Get(':id/matches')
  async matches(@Param('id') id: string) {
    return this.service.getMatches(id);
  }

  @Get(':id/ubo')
  async ubo(@Param('id') id: string) {
    return this.service.getUbo(id);
  }

  @Get(':id/locations')
  async locations(@Param('id') id: string) {
    return this.service.getLocations(id);
  }

  @Get(':id/timeline')
  async timeline(@Param('id') id: string, @Query('page') page?: string, @Query('limit') limit?: string, @Query('fullHistory') fullHistory?: string) {
    return this.service.getTimeline(id, parseInt(page || '1', 10), Math.min(parseInt(limit || '200', 10), 500), fullHistory === 'true');
  }

  @Get('benchmarks/current')
  async benchmarks() {
    return this.service.getBenchmarks();
  }

  @Post(':id/export')
  async export(@Param('id') id: string, @Res() res: any) {
    const pdf = await this.reports.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="tracegraph-${id}.pdf"`,
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  }

  /** GET /api/investigations/compare?ids=id1,id2 — side-by-side comparison */
  @Get('compare')
  async compare(@Query('ids') ids: string) {
    const idList = (ids || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (idList.length < 2) return { error: 'Provide at least 2 investigation IDs separated by commas' };
    return this.service.compare(idList);
  }
}
