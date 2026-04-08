import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { CompanyOfficer } from './company-officer.entity';

@Entity('officers')
export class Officer {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column() externalId: string;

  @Column() name: string;
  @Column({ nullable: true }) nationality: string;
  @Column({ type: 'int', nullable: true }) dateOfBirthMonth: number;
  @Column({ type: 'int', nullable: true }) dateOfBirthYear: number;

  @OneToMany(() => CompanyOfficer, (co) => co.officer)
  companyOfficers: CompanyOfficer[];
}
