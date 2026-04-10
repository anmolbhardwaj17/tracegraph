import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { InvestigationService } from './investigation.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';
import { ReportService } from '../report/report.service';

@Controller('investigations')
export class InvestigationController {
  constructor(
    private readonly service: InvestigationService,
    private readonly reports: ReportService,
  ) {}

  @Post()
  async create(@Body() dto: CreateInvestigationDto) {
    const inv = await this.service.create(dto.query, dto.tier || 'STANDARD');
    return { id: inv.id, status: inv.status, tier: inv.tier };
  }

  @Get()
  async list() {
    return this.service.list();
  }

  @Get('compare')
  async compare(@Query('a') a: string, @Query('b') b: string) {
    return this.service.compare(a, b);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/graph')
  async graph(@Param('id') id: string) {
    return this.service.graphFor(id);
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
}
