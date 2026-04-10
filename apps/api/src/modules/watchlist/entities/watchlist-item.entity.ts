import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('watchlist')
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ unique: true }) companyNumber: string;
  @Column() companyName: string;
  @Column({ type: 'float', nullable: true }) lastRiskScore: number;
  @Column({ nullable: true }) lastInvestigationId: string;
  @Column({ type: 'timestamptz', nullable: true }) lastInvestigatedAt: Date;
  @CreateDateColumn() createdAt: Date;
}
