import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type InvestigationStatus = 'QUEUED' | 'FETCHING' | 'COMPLETE' | 'FAILED';

@Entity('investigations')
export class Investigation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() query: string;
  @Column({ default: 'QUEUED' }) status: InvestigationStatus;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
}
