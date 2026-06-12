import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type CheckFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'MANUAL';

@Entity('watchlist')
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) companyNumber: string;
  @Column() companyName: string;
  @Column({ type: 'float', nullable: true }) lastRiskScore: number;
  @Column({ type: 'float', nullable: true }) previousRiskScore: number;
  @Column({ default: 'STABLE' }) riskChange: string; // UP / DOWN / STABLE
  @Column({ nullable: true }) lastInvestigationId: string;
  @Column({ type: 'timestamptz', nullable: true }) lastInvestigatedAt: Date;
  @Column({ name: 'check_frequency', type: 'varchar', length: 16, default: 'WEEKLY' }) checkFrequency: CheckFrequency;
  @Column({ name: 'next_check_at', type: 'timestamptz', nullable: true }) nextCheckAt: Date | null;
  @CreateDateColumn() createdAt: Date;
}
