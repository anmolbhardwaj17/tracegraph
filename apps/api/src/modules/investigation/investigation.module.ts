import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Investigation } from './entities/investigation.entity';
import { InvestigationService } from './investigation.service';
import { InvestigationController } from './investigation.controller';
import { InvestigationGateway } from './investigation.gateway';
import { InvestigationProcessor, INVESTIGATION_QUEUE } from './investigation.processor';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';
import { GraphModule } from '../graph/graph.module';
import { EntityResolutionModule } from '../entity-resolution/entity-resolution.module';
import { RiskScoringModule } from '../risk-scoring/risk-scoring.module';
import { UboChainModule } from '../ubo-chain/ubo-chain.module';
import { ReportModule } from '../report/report.module';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { IndiaModule } from '../india/india.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { AuthModule } from '../auth/auth.module';
import { PersonsModule } from '../persons/persons.module';
import { FundingModule } from '../funding/funding.module';
import { TeamsModule } from '../teams/teams.module';
import { EntityMatch } from '../entity-resolution/entities/entity-match.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investigation, GraphNode, GraphEdge, EntityMatch]),
    BullModule.forRootAsync({
      useFactory: () => ({
        connection: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        },
      }),
    }),
    BullModule.registerQueue({ name: INVESTIGATION_QUEUE }),
    CompaniesHouseModule,
    GraphModule,
    EntityResolutionModule,
    RiskScoringModule,
    UboChainModule,
    EnrichmentModule,
    IndiaModule,
    IntelligenceModule,
    AuthModule,
    PersonsModule,
    FundingModule,
    TeamsModule,
    forwardRef(() => ReportModule),
  ],
  exports: [InvestigationService],
  providers: [InvestigationService, InvestigationGateway, InvestigationProcessor],
  controllers: [InvestigationController],
})
export class InvestigationModule {}
