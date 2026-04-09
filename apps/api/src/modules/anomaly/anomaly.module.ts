import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { AnomalyDetectionService } from './anomaly.service';
import { AddressAnalysisService } from './address-analysis.service';
import { OwnershipCycleService } from './ownership-cycle.service';
import { CommunityDetectionService } from './community-detection.service';
import { TemporalAnomalyService } from './temporal-anomaly.service';

@Module({
  imports: [TypeOrmModule.forFeature([GraphNode, GraphEdge])],
  providers: [
    AnomalyDetectionService,
    AddressAnalysisService,
    OwnershipCycleService,
    CommunityDetectionService,
    TemporalAnomalyService,
  ],
  exports: [
    AnomalyDetectionService,
    AddressAnalysisService,
    OwnershipCycleService,
    CommunityDetectionService,
    TemporalAnomalyService,
  ],
})
export class AnomalyModule {}
