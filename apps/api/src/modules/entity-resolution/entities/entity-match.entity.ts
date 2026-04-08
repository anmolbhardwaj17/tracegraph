import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type MatchedSource = 'opensanctions' | 'offshore_leaks';

@Entity('entity_matches')
export class EntityMatch {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column('uuid') investigationId: string;

  @Column() sourceEntityType: string; // 'person' | 'company'
  @Column() sourceEntityId: string;   // graph_node entityId
  @Column() matchedSource: MatchedSource;
  @Column() matchedEntityId: string;

  @Column({ type: 'int' }) confidenceScore: number;

  @Column({ type: 'jsonb', nullable: true }) matchReasons: Record<string, any>;

  @CreateDateColumn() createdAt: Date;
}
