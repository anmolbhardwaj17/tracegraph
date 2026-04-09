import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SanctionsEntity } from '../open-sanctions/entities/sanctions-entity.entity';
import { OffshoreEntity } from '../offshore-leaks/entities/offshore-entity.entity';
import { OffshoreOfficer } from '../offshore-leaks/entities/offshore-officer.entity';
import { OffshoreIntermediary } from '../offshore-leaks/entities/offshore-intermediary.entity';
import { DatasetsController } from './datasets.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([SanctionsEntity, OffshoreEntity, OffshoreOfficer, OffshoreIntermediary]),
  ],
  controllers: [DatasetsController],
})
export class DatasetsModule {}
