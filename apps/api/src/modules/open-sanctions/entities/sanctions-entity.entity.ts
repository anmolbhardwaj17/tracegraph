import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('sanctions_entities')
export class SanctionsEntity {
  @PrimaryColumn() id: string;

  @Index()
  @Column() schemaType: string;

  @Column({ type: 'text', array: true, default: [] }) names: string[];
  @Column({ type: 'text', array: true, default: [] }) birthDates: string[];
  @Column({ type: 'text', array: true, default: [] }) nationalities: string[];
  @Column({ type: 'text', array: true, default: [] }) countries: string[];
  @Column({ type: 'text', array: true, default: [] }) topics: string[];
  @Column({ type: 'text', array: true, default: [] }) datasets: string[];
  @Column({ type: 'jsonb', nullable: true }) properties: Record<string, any>;
  @Column({ nullable: true }) sourceUrl: string;

  // For trigram search — concatenation of all names
  @Column({ nullable: true }) searchText: string;
}
