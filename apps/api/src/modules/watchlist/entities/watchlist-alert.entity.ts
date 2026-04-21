import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('watchlist_alerts')
export class WatchlistAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'company_number' })
  companyNumber: string;

  @Column({ name: 'company_name', nullable: true })
  companyName: string;

  @Column({ name: 'alert_type' })
  alertType: string;

  @Column({ default: 'LOW' })
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  @Column()
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'jsonb', default: '{}' })
  metadata: any;

  @Column({ default: false })
  read: boolean;

  @Column({ default: false })
  dismissed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
