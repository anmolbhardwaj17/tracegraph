import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';

@Controller('api/watchlist')
export class WatchlistController {
  constructor(private readonly svc: WatchlistService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  add(@Body() body: { companyNumber: string; companyName: string; investigationId?: string; riskScore?: number }) {
    return this.svc.add(body.companyNumber, body.companyName, body.investigationId, body.riskScore);
  }

  @Delete(':companyNumber')
  remove(@Param('companyNumber') companyNumber: string) {
    return this.svc.remove(companyNumber);
  }
}
