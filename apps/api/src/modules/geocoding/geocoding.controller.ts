import { Controller, Get, Query } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

@Controller('geocoding')
export class GeocodingController {
  constructor(private readonly geocoding: GeocodingService) {}

  @Get()
  async geocode(@Query('q') q: string) {
    if (!q || q.trim().length < 3) return { result: null };
    const result = await this.geocoding.geocode(q);
    return { result };
  }
}
