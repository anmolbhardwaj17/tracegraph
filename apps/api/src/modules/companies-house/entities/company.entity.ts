import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Index, CreateDateColumn } from 'typeorm';
import { Address } from './address.entity';
import { CompanyOfficer } from './company-officer.entity';
import { PSC } from './psc.entity';

@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index({ unique: true })
  @Column() companyNumber: string;

  @Column() name: string;
  @Column({ nullable: true }) status: string;
  @Column({ type: 'date', nullable: true }) incorporationDate: string;
  @Column({ nullable: true }) companyType: string;
  @Column({ nullable: true }) jurisdiction: string;

  @Column({ type: 'text', array: true, default: [] }) sicCodes: string[];

  @ManyToOne(() => Address, { nullable: true, cascade: true, eager: true })
  @JoinColumn({ name: 'address_id' })
  address: Address;

  @OneToMany(() => CompanyOfficer, (co) => co.company)
  companyOfficers: CompanyOfficer[];

  @OneToMany(() => PSC, (p) => p.company)
  pscs: PSC[];

  @CreateDateColumn() createdAt: Date;
}
