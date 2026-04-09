import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';
import { AnomalyDetectionService } from './anomaly.service';
import { AddressAnalysisService } from './address-analysis.service';
import { OwnershipCycleService } from './ownership-cycle.service';
import { CommunityDetectionService } from './community-detection.service';
import { TemporalAnomalyService } from './temporal-anomaly.service';
import { CompanyClassifierService } from './company-classifier.service';
import { DirectorRiskService } from './director-risk.service';
import { FilingHealthService } from './filing-health.service';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';

@Module({
  imports: [TypeOrmModule.forFeature([GraphNode, GraphEdge]), CompaniesHouseModule],
  providers: [
    AnomalyDetectionService,
    AddressAnalysisService,
    OwnershipCycleService,
    CommunityDetectionService,
    TemporalAnomalyService,
    CompanyClassifierService,
    DirectorRiskService,
    FilingHealthService,
  ],
  exports: [
    AnomalyDetectionService,
    AddressAnalysisService,
    OwnershipCycleService,
    CommunityDetectionService,
    TemporalAnomalyService,
    CompanyClassifierService,
    DirectorRiskService,
    FilingHealthService,
  ],
})
export class AnomalyModule {}
