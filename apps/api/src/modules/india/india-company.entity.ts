import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('india_companies')
export class IndiaCompany {
  @PrimaryColumn({ length: 21 })
  cin: string;

  @Column({ name: 'company_name', length: 500 })
  companyName: string;

  @Column({ nullable: true, length: 50 })
  status: string;

  @Column({ name: 'company_type', nullable: true, length: 100 })
  companyType: string;

  @Column({ name: 'company_class', nullable: true, length: 50 })
  companyClass: string;

  @Column({ nullable: true, length: 100 })
  category: string;

  @Column({ name: 'sub_category', nullable: true, length: 100 })
  subCategory: string;

  @Column({ name: 'date_of_registration', type: 'date', nullable: true })
  dateOfRegistration: Date | null;

  @Column({ name: 'authorized_capital', type: 'bigint', nullable: true })
  authorizedCapital: number | null;

  @Column({ name: 'paid_up_capital', type: 'bigint', nullable: true })
  paidUpCapital: number | null;

  @Column({ nullable: true, length: 100 })
  state: string;

  @Column({ nullable: true, length: 100 })
  roc: string;

  @Column({ name: 'activity_code', nullable: true, length: 10 })
  activityCode: string;

  @Column({ name: 'activity_description', nullable: true, length: 500 })
  activityDescription: string;

  @Column({ name: 'registered_address', type: 'text', nullable: true })
  registeredAddress: string;

  @Column({ nullable: true, length: 255 })
  email: string;

  @Column({ name: 'listed_status', nullable: true, length: 20 })
  listedStatus: string;

  @Column({ name: 'last_agm_date', type: 'date', nullable: true })
  lastAgmDate: Date | null;

  @Column({ name: 'balance_sheet_date', type: 'date', nullable: true })
  balanceSheetDate: Date | null;
}
