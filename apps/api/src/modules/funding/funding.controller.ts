import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { CapitalEventsService } from './capital-events.service';

@ApiTags('Funding')
@Controller('investigations')
export class FundingController {
  constructor(private readonly funding: CapitalEventsService) {}

  @Get(':id/funding')
  @Public()
  async getFunding(@Param('id') id: string) {
    const events = await this.funding.getForInvestigation(id);
    return { events, total: events.length };
  }
}
