import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Investigation } from './entities/investigation.entity';
import { InvestigationService } from './investigation.service';
import { InvestigationController } from './investigation.controller';
import { InvestigationGateway } from './investigation.gateway';
import { InvestigationProcessor, INVESTIGATION_QUEUE } from './investigation.processor';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';
import { GraphModule } from '../graph/graph.module';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Investigation, GraphNode, GraphEdge]),
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
  ],
  providers: [InvestigationService, InvestigationGateway, InvestigationProcessor],
  controllers: [InvestigationController],
})
export class InvestigationModule {}
