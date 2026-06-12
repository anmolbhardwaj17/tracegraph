import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EntityMergeService } from './entity-merge.service';
import { GraphAnalyticsService } from './graph-analytics.service';
import { TemporalAnalysisService } from './temporal-analysis.service';
import { PeerComparisonService } from './peer-comparison.service';
import { FilingNlpService } from './filing-nlp.service';
import { ProactiveCrawlerService } from './proactive-crawler.service';
import { TraceyService } from './tracey.service';
import { MemoGeneratorService } from './memo-generator.service';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { Investigation } from '../investigation/entities/investigation.entity';

const services = [
  EntityMergeService,
  GraphAnalyticsService,
  TemporalAnalysisService,
  PeerComparisonService,
  FilingNlpService,
  ProactiveCrawlerService,
  TraceyService,
  MemoGeneratorService,
];

@Module({
  imports: [TypeOrmModule.forFeature([GraphNode, GraphEdge, Investigation])],
  providers: services,
  exports: services,
})
export class IntelligenceModule {}
