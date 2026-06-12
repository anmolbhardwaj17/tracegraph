import { Module } from '@nestjs/common';
import { JurisdictionsController } from './jurisdictions.controller';
import { EnrichmentModule } from '../enrichment/enrichment.module';

@Module({
  imports: [EnrichmentModule],
  controllers: [JurisdictionsController],
})
export class JurisdictionsModule {}
