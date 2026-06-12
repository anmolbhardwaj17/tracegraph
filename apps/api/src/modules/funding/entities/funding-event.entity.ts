import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type FundingEventType =
  | 'EQUITY_RAISE'
  | 'SHARE_CLASS_CHANGE'
  | 'CAPITAL_REDUCTION'
  | 'DEBT_FACILITY'
  | 'CHARGE_CREATED'
  | 'CHARGE_SATISFIED'
  | 'FORM_D_RAISE';

@Entity('funding_events')
export class FundingEvent {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'investigation_id', type: 'uuid' }) investigationId: string;

  @Index()
  @Column({ name: 'company_entity_id', type: 'varchar' }) companyEntityId: string;

  @Column({ name: 'company_name', type: 'varchar', nullable: true }) companyName: string | null;
  @Column({ name: 'event_type', type: 'varchar', length: 50 }) eventType: FundingEventType;
  @Column({ name: 'event_date', type: 'date', nullable: true }) eventDate: Date | null;
  @Column({ name: 'amount_minor', type: 'bigint', nullable: true }) amountMinor: number | null;
  @Column({ type: 'varchar', length: 10, default: 'GBP' }) currency: string;
  @Column({ name: 'share_class', type: 'varchar', nullable: true }) shareClass: string | null;
  @Column({ type: 'jsonb', nullable: true }) details: Record<string, any> | null;
  @Column({ type: 'varchar' }) source: string;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
