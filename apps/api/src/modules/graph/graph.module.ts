import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GraphNode } from './entities/graph-node.entity';
import { GraphEdge } from './entities/graph-edge.entity';
import { GraphExpansionService } from './graph-expansion.service';
import { AddressService } from './address.service';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';
import { GeocodingModule } from '../geocoding/geocoding.module';

@Module({
  imports: [TypeOrmModule.forFeature([GraphNode, GraphEdge]), CompaniesHouseModule, GeocodingModule],
  providers: [GraphExpansionService, AddressService],
  exports: [GraphExpansionService, AddressService, TypeOrmModule],
})
export class GraphModule {}
