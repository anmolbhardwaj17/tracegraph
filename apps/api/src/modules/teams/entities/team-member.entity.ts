import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Team } from './team.entity';

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MemberStatus = 'active' | 'invited';

@Entity('team_members')
export class TeamMember {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'team_id', type: 'uuid' }) teamId: string;
  @ManyToOne(() => Team, (t) => t.members, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'team_id' }) team: Team;
  @Column({ name: 'user_id', type: 'varchar', nullable: true }) userId: string | null;
  @Column({ name: 'invited_email', type: 'varchar', nullable: true }) invitedEmail: string | null;
  @Column({ type: 'varchar', length: 20, default: 'member' }) role: TeamRole;
  @Column({ type: 'varchar', length: 20, default: 'active' }) status: MemberStatus;
  @CreateDateColumn({ name: 'invited_at' }) invitedAt: Date;
  @Column({ name: 'joined_at', type: 'timestamptz', nullable: true }) joinedAt: Date | null;
}
