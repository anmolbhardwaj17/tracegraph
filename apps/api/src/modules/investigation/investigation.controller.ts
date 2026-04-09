import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { InvestigationService } from './investigation.service';
import { CreateInvestigationDto } from './dto/create-investigation.dto';

@Controller('investigations')
export class InvestigationController {
  constructor(private readonly service: InvestigationService) {}

  @Post()
  async create(@Body() dto: CreateInvestigationDto) {
    const inv = await this.service.create(dto.query);
    return { id: inv.id, status: inv.status };
  }

  @Get()
  async list() {
    return this.service.list();
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/graph')
  async graph(@Param('id') id: string) {
    return this.service.graphFor(id);
  }
}
