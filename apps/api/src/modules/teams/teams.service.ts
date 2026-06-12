import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { InvestigationComment } from './entities/investigation-comment.entity';
import { Investigation } from '../investigation/entities/investigation.entity';
import { EmailService } from '../notifications/email.service';

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(TeamMember) private readonly members: Repository<TeamMember>,
    @InjectRepository(InvestigationComment) private readonly comments: Repository<InvestigationComment>,
    @InjectRepository(Investigation) private readonly investigations: Repository<Investigation>,
    private readonly email: EmailService,
  ) {}

  // ─── Teams ───────────────────────────────────────────────────────

  async createTeam(name: string, ownerId: string): Promise<Team> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 50) + '-' + Math.random().toString(36).slice(2, 6);
    const team = await this.teams.save(this.teams.create({ name, slug, ownerId }));
    // Owner is automatically a member
    await this.members.save(this.members.create({ teamId: team.id, userId: ownerId, role: 'owner', status: 'active', joinedAt: new Date() }));
    return team;
  }

  async getTeam(teamId: string): Promise<Team | null> {
    return this.teams.findOne({ where: { id: teamId }, relations: ['members'] });
  }

  async getUserTeams(userId: string): Promise<Team[]> {
    const memberships = await this.members.find({ where: { userId, status: 'active' } });
    if (memberships.length === 0) return [];
    const teamIds = memberships.map((m) => m.teamId);
    return this.teams.findByIds(teamIds);
  }

  async getMembers(teamId: string) {
    return this.members.find({ where: { teamId }, order: { invitedAt: 'ASC' } });
  }

  async inviteMember(teamId: string, invitedEmail: string, role: 'admin' | 'member' | 'viewer' = 'member'): Promise<TeamMember> {
    // Check if already a member
    const existing = await this.members.findOne({ where: { teamId, invitedEmail } });
    if (existing) return existing;

    const member = await this.members.save(
      this.members.create({ teamId, invitedEmail, role, status: 'invited' }),
    );

    // Send invite email
    const team = await this.teams.findOne({ where: { id: teamId } });
    await this.sendInviteEmail(invitedEmail, team?.name || 'TraceGraph Team');

    return member;
  }

  async removeMember(teamId: string, memberId: string): Promise<void> {
    await this.members.delete({ id: memberId, teamId });
  }

  async updateMemberRole(teamId: string, memberId: string, role: 'admin' | 'member' | 'viewer'): Promise<void> {
    await this.members.update({ id: memberId, teamId }, { role });
  }

  /** Called on login — activate any pending invites for this email */
  async activatePendingInvites(userId: string, email: string): Promise<void> {
    const pending = await this.members.find({ where: { invitedEmail: email, status: 'invited' } });
    for (const m of pending) {
      await this.members.update(m.id, { userId, status: 'active', joinedAt: new Date() });
    }
  }

  // ─── Investigation sharing ────────────────────────────────────────

  async enableSharing(investigationId: string): Promise<string> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    if (!inv) throw new Error('Investigation not found');
    const token = (inv as any).shareToken || randomUUID();
    await this.investigations.update(investigationId, { shareToken: token, shareEnabled: true } as any);
    return token;
  }

  async disableSharing(investigationId: string): Promise<void> {
    await this.investigations.update(investigationId, { shareEnabled: false } as any);
  }

  async getShareStatus(investigationId: string): Promise<{ enabled: boolean; token: string | null }> {
    const inv = await this.investigations.findOne({ where: { id: investigationId } });
    return { enabled: (inv as any)?.shareEnabled || false, token: (inv as any)?.shareToken || null };
  }

  async getByShareToken(token: string): Promise<any | null> {
    const inv = await this.investigations.findOne({ where: { shareToken: token, shareEnabled: true } as any });
    if (!inv) return null;
    const progress = inv.progress || {} as any;
    return {
      id: inv.id,
      companyName: inv.metadata?.companyName || inv.query,
      status: inv.status,
      tier: inv.tier,
      riskScore: progress.riskScore,
      riskClassification: progress.riskClassification,
      findings: (progress.findings || []).slice(0, 10),
      pepCount: progress.pepCount || 0,
      sanctionsMatches: progress.directSanctions?.matches || 0,
      narrative: progress.narrative?.executiveSummary || null,
      completedAt: inv.completedAt,
    };
  }

  async assignToTeam(investigationId: string, teamId: string): Promise<void> {
    await this.investigations.update(investigationId, { teamId } as any);
  }

  async getTeamInvestigations(teamId: string) {
    return this.investigations.find({ where: { teamId } as any, order: { createdAt: 'DESC' } });
  }

  // ─── Comments ────────────────────────────────────────────────────

  async addComment(investigationId: string, body: string, authorName?: string, authorId?: string): Promise<InvestigationComment> {
    return this.comments.save(
      this.comments.create({ investigationId, body, authorName: authorName || 'Anonymous', authorId: authorId || null }),
    );
  }

  async getComments(investigationId: string): Promise<InvestigationComment[]> {
    return this.comments.find({ where: { investigationId }, order: { createdAt: 'ASC' } });
  }

  async deleteComment(commentId: string, authorId?: string): Promise<void> {
    const where: any = { id: commentId };
    if (authorId) where.authorId = authorId;
    await this.comments.delete(where);
  }

  // ─── Private ──────────────────────────────────────────────────────

  private async sendInviteEmail(toEmail: string, teamName: string): Promise<void> {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    // Use existing email service — simple invite template
    if ((this.email as any).resend) {
      await (this.email as any).resend.emails.send({
        from: 'TraceGraph <noreply@tracegraph.io>',
        to: toEmail,
        subject: `You've been invited to join ${teamName} on TraceGraph`,
        html: `
          <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:32px;max-width:600px;margin:0 auto">
            <h2 style="color:#f8fafc">You're invited to ${teamName}</h2>
            <p style="color:#94a3b8">A team on TraceGraph has invited you to collaborate on M&A due diligence.</p>
            <a href="${appUrl}/auth?invited=true&email=${encodeURIComponent(toEmail)}"
              style="display:inline-block;margin-top:16px;background:#f8fafc;color:#0f172a;padding:12px 24px;font-weight:600;text-decoration:none">
              Accept invitation
            </a>
            <p style="margin-top:24px;font-size:12px;color:#475569">
              Create an account with this email address to be automatically added to the team.
            </p>
          </body>
        `,
      }).catch((e: any) => this.logger.warn(`Invite email failed: ${e?.message}`));
    }
  }
}
