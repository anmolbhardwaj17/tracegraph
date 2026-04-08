import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type GraphEntityType = 'company' | 'person' | 'address';

@Entity('graph_nodes')
@Index(['investigationId', 'entityType', 'entityId'], { unique: true })
export class GraphNode {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') investigationId: string;

  @Column() entityType: GraphEntityType;

  @Column() entityId: string;

  @Column() label: string;

  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
}
