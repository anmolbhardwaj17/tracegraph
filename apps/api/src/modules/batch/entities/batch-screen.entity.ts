import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('batch_screens')
export class BatchScreen {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  name: string;

  @Column({ default: 'PENDING' })
  status: 'PENDING' | 'RUNNING' | 'COMPLETE' | 'FAILED';

  @Column({ default: 'QUICK' })
  tier: string;

  @Column({ default: 'us' })
  jurisdiction: string;

  @Column({ name: 'total_companies', default: 0 })
  totalCompanies: number;

  @Column({ default: 0 })
  completed: number;

  @Column({ default: 0 })
  failed: number;

  @Column({ name: 'investigation_ids', type: 'jsonb', default: '[]' })
  investigationIds: string[];

  @Column({ type: 'jsonb', default: '[]' })
  results: any[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
