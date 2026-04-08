import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Company } from './company.entity';
import { Officer } from './officer.entity';

@Entity('company_officers')
export class CompanyOfficer {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Company, (c) => c.companyOfficers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @ManyToOne(() => Officer, (o) => o.companyOfficers, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'officer_id' })
  officer: Officer;

  @Column({ nullable: true }) role: string;
  @Column({ type: 'date', nullable: true }) appointedOn: string;
  @Column({ type: 'date', nullable: true }) resignedOn: string;
}
