import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type RelationshipType = 'director' | 'psc' | 'address' | 'appointment';

@Entity('graph_edges')
@Index(['investigationId', 'sourceNodeId', 'targetNodeId', 'relationshipType'], { unique: true })
export class GraphEdge {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') investigationId: string;

  @Column('uuid') sourceNodeId: string;
  @Column('uuid') targetNodeId: string;

  @Column() relationshipType: RelationshipType;

  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
}
