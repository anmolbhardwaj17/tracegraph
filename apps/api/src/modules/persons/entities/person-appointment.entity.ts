import { Column, Entity, Index, ManyToOne, JoinColumn, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';
import { Person } from './person.entity';

@Entity('person_appointments')
export class PersonAppointment {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ name: 'person_id', type: 'uuid' }) personId: string;

  @ManyToOne(() => Person, (p) => p.appointments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'person_id' })
  person: Person;

  @Index()
  @Column({ name: 'investigation_id', type: 'uuid' }) investigationId: string;

  @Column({ name: 'company_entity_id', type: 'varchar' }) companyEntityId: string;
  @Column({ name: 'company_name', type: 'varchar' }) companyName: string;
  @Column({ name: 'company_status', type: 'varchar', nullable: true }) companyStatus: string | null;
  @Column({ name: 'company_jurisdiction', type: 'varchar', nullable: true }) companyJurisdiction: string | null;
  @Column({ type: 'varchar', nullable: true }) role: string | null;
  @Column({ name: 'appointed_on', type: 'date', nullable: true }) appointedOn: Date | null;
  @Column({ name: 'resigned_on', type: 'date', nullable: true }) resignedOn: Date | null;
  @Column({ type: 'varchar', nullable: true }) source: string | null;

  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
