import { Body, Controller, Delete, Get, Param, Post, Query, Res, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InvestigationService } from './investigation.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { ReportService } from '../report/report.service';
import { Public } from '../auth/guards/jwt-auth.guard';
import { AuthService } from '../auth/auth.service';
import { TraceyService } from '../intelligence/tracey.service';

@ApiTags('Investigations')
@Controller('investigations')
export class InvestigationController {
  constructor(
    private readonly service: InvestigationService,
    private readonly reports: ReportService,
    private readonly auth: AuthService,
    private readonly tracey: TraceyService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create investigation (requires auth)' })
  async create(@Body() dto: CreateInvestigationDto, @Req() req: any) {
    // Check usage limits
    const userId = req.user?.id;
    if (userId) {
      const usage = await this.auth.canInvestigate(userId);
      if (!usage.allowed) {
        return { error: 'Investigation limit reached', remaining: 0, limit: usage.limit, upgrade: true };
      }
      await this.auth.incrementUsage(userId);
      await this.auth.audit(userId, 'CREATE_INVESTIGATION', 'investigation', null as any, { query: dto.query, jurisdiction: dto.jurisdiction, tier: dto.tier });
    }
    const inv = await this.service.create(dto.query, dto.tier || 'STANDARD', dto.jurisdiction || 'gb');
    return { id: inv.id, status: inv.status, tier: inv.tier };
  }

  @Get()
  @Public()
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
  @Public()
  async stats() {
    return this.service.stats();
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Get(':id')
  @Public()
  async get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/meta')
  @Public()
  async meta(@Param('id') id: string) {
    return this.service.getMeta(id);
  }

  @Get(':id/overview')
  @Public()
  async overview(@Param('id') id: string) {
    return this.service.getOverview(id);
  }

  @Get(':id/graph')
  @Public()
  async graph(@Param('id') id: string) {
    return this.service.graphFor(id);
  }

  @Get(':id/findings')
  @Public()
  async findings(@Param('id') id: string) {
    return this.service.getFindings(id);
  }

  @Get(':id/entities')
  @Public()
  async entities(@Param('id') id: string, @Query('type') type?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.getEntities(id, type, parseInt(page || '1', 10), Math.min(parseInt(limit || '50', 10), 200));
  }

  @Get(':id/matches')
  @Public()
  async matches(@Param('id') id: string) {
    return this.service.getMatches(id);
  }

  @Get(':id/ubo')
  @Public()
  async ubo(@Param('id') id: string) {
    return this.service.getUbo(id);
  }

  @Get(':id/locations')
  @Public()
  async locations(@Param('id') id: string) {
    return this.service.getLocations(id);
  }

  @Get(':id/timeline')
  @Public()
  async timeline(@Param('id') id: string, @Query('page') page?: string, @Query('limit') limit?: string, @Query('fullHistory') fullHistory?: string) {
    return this.service.getTimeline(id, parseInt(page || '1', 10), Math.min(parseInt(limit || '200', 10), 500), fullHistory === 'true');
  }

  @Get('benchmarks/current')
  @Public()
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

  /** POST /api/investigations/:id/chat — chat with Tracey about this investigation */
  @Post(':id/chat')
  @Public()
  @ApiOperation({ summary: 'Chat with Tracey AI about this investigation' })
  async chat(@Param('id') id: string, @Body() body: { question: string; userName?: string; history?: Array<{ role: 'user' | 'assistant'; content: string }> }) {
    if (!body.question?.trim()) return { reply: 'Please ask a question about this investigation.', sources: [], followUps: [] };
    return this.tracey.chat(id, body.question, body.history || [], body.userName);
  }
}
