import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User } from './entities/user.entity';
import { AuditLog } from './entities/audit-log.entity';

const PLAN_LIMITS: Record<string, number> = {
  free: 5,
  pro: 50,
  enterprise: 99999,
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    private readonly jwt: JwtService,
  ) {}

  /** Signup with email + password */
  async signup(email: string, password: string, name?: string): Promise<{ user: any; accessToken: string }> {
    const existing = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await this.users.save(this.users.create({
      email: email.toLowerCase(),
      passwordHash,
      name: name || email.split('@')[0],
      role: 'user',
      plan: 'free',
      investigationLimit: PLAN_LIMITS.free,
    }));

    await this.audit(user.id, 'SIGNUP', 'user', user.id, { method: 'email' });

    const accessToken = this.generateToken(user);
    return { user: this.sanitize(user), accessToken };
  }

  /** Login with email + password */
  async login(email: string, password: string, ip?: string): Promise<{ user: any; accessToken: string }> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    user.lastLoginAt = new Date();
    await this.users.save(user);
    await this.audit(user.id, 'LOGIN', 'user', user.id, { method: 'email', ip });

    const accessToken = this.generateToken(user);
    return { user: this.sanitize(user), accessToken };
  }

  /** Google OAuth login/signup (placeholder — needs Google client ID) */
  async googleAuth(idToken: string): Promise<{ user: any; accessToken: string }> {
    // TODO: Verify idToken with Google's API when GOOGLE_CLIENT_ID is set
    // const ticket = await googleClient.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    // const payload = ticket.getPayload();
    // For now, return an error directing the user to set up Google OAuth
    throw new UnauthorizedException(
      'Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env',
    );
  }

  /** Get user by ID */
  async getUser(userId: string): Promise<any> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    return this.sanitize(user);
  }

  /** Check if user can create a new investigation (usage limit) */
  async canInvestigate(userId: string): Promise<{ allowed: boolean; remaining: number; limit: number }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) return { allowed: false, remaining: 0, limit: 0 };

    const remaining = user.investigationLimit - user.investigationCount;
    return {
      allowed: remaining > 0,
      remaining: Math.max(0, remaining),
      limit: user.investigationLimit,
    };
  }

  /** Increment investigation count */
  async incrementUsage(userId: string): Promise<void> {
    await this.users.increment({ id: userId }, 'investigationCount', 1);
  }

  /** Reset monthly usage (call from cron) */
  async resetMonthlyUsage(): Promise<void> {
    await this.users.update({}, { investigationCount: 0 });
    this.logger.log('Monthly usage reset for all users');
  }

  /** Upgrade plan */
  async upgradePlan(userId: string, plan: 'free' | 'pro' | 'enterprise'): Promise<any> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    user.plan = plan;
    user.investigationLimit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    await this.users.save(user);
    await this.audit(userId, 'PLAN_UPGRADE', 'user', userId, { plan });

    return this.sanitize(user);
  }

  /** Update branding (white-label) */
  async updateBranding(userId: string, logoUrl?: string, companyName?: string): Promise<any> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');

    if (logoUrl !== undefined) user.logoUrl = logoUrl;
    if (companyName !== undefined) user.companyName = companyName;
    await this.users.save(user);

    return this.sanitize(user);
  }

  // ── Audit Trail ──

  async audit(userId: string | null, action: string, resourceType?: string, resourceId?: string, details?: any, ip?: string): Promise<void> {
    await this.auditLogs.save(this.auditLogs.create({
      userId: userId || undefined,
      action,
      resourceType,
      resourceId,
      details: details || {},
      ipAddress: ip,
    } as any)).catch(() => {});
  }

  async getAuditLog(userId: string, limit = 50): Promise<AuditLog[]> {
    return this.auditLogs.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  // ── Helpers ──

  private generateToken(user: User): string {
    return this.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      plan: user.plan,
    });
  }

  private sanitize(user: User): any {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      plan: user.plan,
      avatarUrl: user.avatarUrl,
      investigationCount: user.investigationCount,
      investigationLimit: user.investigationLimit,
      logoUrl: user.logoUrl,
      companyName: user.companyName,
      createdAt: user.createdAt,
    };
  }
}
