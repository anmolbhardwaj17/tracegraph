import { Controller, Get, Query } from '@nestjs/common';
import { LogosService } from './logos.service';

@Controller('companies')
export class LogosController {
  constructor(private readonly logos: LogosService) {}

  @Get('logo')
  async lookup(@Query('name') name: string) {
    if (!name || name.trim().length < 2) return { url: null, source: null };
    return this.logos.lookup(name);
  }
}
