import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('investigation_activity')
export class InvestigationActivity {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'investigation_id', type: 'uuid' }) investigationId: string;

  @Column({ name: 'actor_name', type: 'varchar', nullable: true }) actorName: string | null;
  @Column({ type: 'varchar' }) action: string;
  @Column({ type: 'jsonb', nullable: true }) payload: Record<string, any> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
