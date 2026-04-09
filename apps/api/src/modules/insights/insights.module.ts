import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Investigation } from '../investigation/entities/investigation.entity';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { EntityMatch } from '../entity-resolution/entities/entity-match.entity';
import { InsightsService } from './insights.service';
import { InsightsController } from './insights.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Investigation, GraphNode, EntityMatch])],
  providers: [InsightsService],
  controllers: [InsightsController],
  exports: [InsightsService],
})
export class InsightsModule {}
