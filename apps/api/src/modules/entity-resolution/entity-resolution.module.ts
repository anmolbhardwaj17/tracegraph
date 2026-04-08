import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityMatch } from './entities/entity-match.entity';
import { EntityResolutionService } from './entity-resolution.service';
import { SanctionsProximityService } from './proximity.service';
import { GraphModule } from '../graph/graph.module';
import { OpenSanctionsModule } from '../open-sanctions/open-sanctions.module';
import { OffshoreLeaksModule } from '../offshore-leaks/offshore-leaks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([EntityMatch]),
    GraphModule,
    OpenSanctionsModule,
    OffshoreLeaksModule,
  ],
  providers: [EntityResolutionService, SanctionsProximityService],
  exports: [EntityResolutionService, SanctionsProximityService, TypeOrmModule],
})
export class EntityResolutionModule {}
