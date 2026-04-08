import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Company } from './company.entity';

@Entity('psc')
export class PSC {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Company, (c) => c.pscs, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column() name: string;
  @Column({ nullable: true }) kind: string;
  @Column({ type: 'text', array: true, default: [] }) naturesOfControl: string[];
  @Column({ type: 'date', nullable: true }) notifiedOn: string;
}
