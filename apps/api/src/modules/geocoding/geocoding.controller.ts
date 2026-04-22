import { Public } from '../auth/guards/jwt-auth.guard';
import { Controller, Get, Query } from '@nestjs/common';
import { GeocodingService } from './geocoding.service';

@Public()
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
