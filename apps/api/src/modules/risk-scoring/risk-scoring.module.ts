import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { Investigation } from '../investigation/entities/investigation.entity';
import { EntityMatch } from '../entity-resolution/entities/entity-match.entity';
import { RiskScoringService } from './risk-scoring.service';
import { AnomalyModule } from '../anomaly/anomaly.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([GraphNode, GraphEdge, Investigation, EntityMatch]),
    AnomalyModule,
  ],
  providers: [RiskScoringService],
  exports: [RiskScoringService],
})
export class RiskScoringModule {}
