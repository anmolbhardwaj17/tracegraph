import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/guards/jwt-auth.guard';
import { PersonsService } from './persons.service';

@ApiTags('Persons')
@Controller('persons')
export class PersonsController {
  constructor(private readonly persons: PersonsService) {}

  @Get('search')
  @Public()
  async search(@Query('q') q: string, @Query('limit') limit?: string) {
    if (!q?.trim()) return { items: [] };
    const results = await this.persons.search(q.trim(), Math.min(parseInt(limit || '20', 10), 50));
    return { items: results };
  }

  @Get(':id')
  @Public()
  async getById(@Param('id') id: string) {
    const person = await this.persons.findById(id);
    if (!person) return { error: 'Person not found' };
    const stats = await this.persons.getStats(id);
    return { person, stats };
  }

  @Get(':id/track-record')
  @Public()
  async trackRecord(@Param('id') id: string) {
    const record = await this.persons.getTrackRecord(id);
    return { items: record, total: record.length };
  }
}
