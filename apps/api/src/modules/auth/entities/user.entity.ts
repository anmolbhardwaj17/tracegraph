import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column({ name: 'password_hash', nullable: true })
  passwordHash: string;

  @Column({ nullable: true })
  name: string;

  @Column({ default: 'user' })
  role: 'user' | 'admin';

  @Column({ default: 'free' })
  plan: 'free' | 'pro' | 'enterprise';

  @Column({ name: 'google_id', nullable: true, unique: true })
  googleId: string;

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string;

  @Column({ name: 'investigation_count', default: 0 })
  investigationCount: number;

  @Column({ name: 'investigation_limit', default: 5 })
  investigationLimit: number;

  @Column({ name: 'logo_url', nullable: true })
  logoUrl: string;

  @Column({ name: 'company_name', nullable: true })
  companyName: string;

  @Column({ name: 'stripe_customer_id', nullable: true })
  stripeCustomerId: string;

  @Column({ name: 'stripe_subscription_id', nullable: true })
  stripeSubscriptionId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date;
}
