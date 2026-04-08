import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('addresses')
export class Address {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ nullable: true }) addressLine1: string;
  @Column({ nullable: true }) addressLine2: string;
  @Column({ nullable: true }) locality: string;
  @Column({ nullable: true }) region: string;
  @Column({ nullable: true }) postalCode: string;
  @Column({ nullable: true }) country: string;
  @Column({ nullable: true }) normalized: string;
}
