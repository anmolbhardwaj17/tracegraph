import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphNode } from './entities/graph-node.entity';
import { GraphEdge } from './entities/graph-edge.entity';
import { GraphExpansionService } from './graph-expansion.service';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';

@Module({
  imports: [TypeOrmModule.forFeature([GraphNode, GraphEdge]), CompaniesHouseModule],
  providers: [GraphExpansionService],
  exports: [GraphExpansionService, TypeOrmModule],
})
export class GraphModule {}
