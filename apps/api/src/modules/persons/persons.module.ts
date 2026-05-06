import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Person } from './entities/person.entity';
import { PersonAppointment } from './entities/person-appointment.entity';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { GraphNode } from '../graph/entities/graph-node.entity';
import { GraphEdge } from '../graph/entities/graph-edge.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Person, PersonAppointment, GraphNode, GraphEdge])],
  providers: [PersonsService],
  controllers: [PersonsController],
  exports: [PersonsService],
})
export class PersonsModule {}
