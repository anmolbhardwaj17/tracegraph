import { Column, Entity, Index, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { PersonAppointment } from './person-appointment.entity';

@Entity('persons')
export class Person {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'canonical_name', type: 'varchar' }) canonicalName: string;

  @Index()
  @Column({ name: 'normalized_name', type: 'varchar' }) normalizedName: string;

  @Column({ name: 'dob_month', type: 'int', nullable: true }) dobMonth: number | null;

  @Index()
  @Column({ name: 'dob_year', type: 'int', nullable: true }) dobYear: number | null;

  @Column({ type: 'varchar', nullable: true }) nationality: string | null;
  @Column({ name: 'investigation_count', default: 1 }) investigationCount: number;

  @Column({ name: 'first_seen_at', type: 'timestamptz', default: () => 'NOW()' }) firstSeenAt: Date;
  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'NOW()' }) lastSeenAt: Date;

  @Column({ type: 'jsonb', nullable: true }) signals: Record<string, any> | null;
  @Column({ type: 'jsonb', nullable: true }) metadata: Record<string, any> | null;

  @OneToMany(() => PersonAppointment, (a) => a.person) appointments: PersonAppointment[];
}
