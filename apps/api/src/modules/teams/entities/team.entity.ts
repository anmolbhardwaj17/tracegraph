import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { TeamMember } from './team-member.entity';

@Entity('teams')
export class Team {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar' }) name: string;
  @Column({ type: 'varchar', nullable: true, unique: true }) slug: string | null;
  @Column({ name: 'owner_id', type: 'uuid', nullable: true }) ownerId: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @OneToMany(() => TeamMember, (m) => m.team) members: TeamMember[];
}
