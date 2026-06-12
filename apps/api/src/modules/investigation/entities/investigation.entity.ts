import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type InvestigationStatus = 'QUEUED' | 'FETCHING' | 'EXPANDING' | 'RESOLVING' | 'SCORING' | 'COMPLETE' | 'FAILED';
export type InvestigationTier = 'QUICK' | 'STANDARD' | 'DEEP';
export type DealStage = 'TARGETING' | 'INITIAL_SCREEN' | 'MEETING' | 'DD' | 'IOI' | 'LOI' | 'CLOSING' | 'CLOSED_WON' | 'CLOSED_LOST';
export type DealPriority = 'HIGH' | 'NORMAL' | 'LOW';

@Entity('investigations')
export class Investigation {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() query: string;
  @Column({ default: 'QUEUED' }) status: InvestigationStatus;
  @Column({ default: 'STANDARD' }) tier: InvestigationTier;
  @CreateDateColumn() createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) completedAt: Date;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true }) progress: Record<string, any>;

  // Pipeline columns — snake_case names match migration-created columns
  @Column({ name: 'deal_stage', type: 'varchar', length: 32, nullable: true }) dealStage: DealStage | null;
  @Column({ name: 'deal_priority', type: 'varchar', length: 16, default: 'NORMAL' }) dealPriority: DealPriority;
  @Column({ name: 'deal_size_estimate', type: 'bigint', nullable: true }) dealSizeEstimate: number | null;
  @Column({ name: 'deal_owner_name', type: 'varchar', nullable: true }) dealOwnerName: string | null;

  // Sharing
  @Column({ name: 'share_token', type: 'uuid', nullable: true }) shareToken: string | null;
  @Column({ name: 'share_enabled', type: 'boolean', default: false }) shareEnabled: boolean;
  @Column({ name: 'team_id', type: 'uuid', nullable: true }) teamId: string | null;
}
