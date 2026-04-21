import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IndiaCompany } from './india-company.entity';
import { IndiaSearchService } from './india-search.service';

@Module({
  imports: [TypeOrmModule.forFeature([IndiaCompany])],
  providers: [IndiaSearchService],
  exports: [IndiaSearchService],
})
export class IndiaModule {}
