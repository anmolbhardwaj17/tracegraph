import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('logo_cache')
export class LogoCache {
  @PrimaryColumn() nameKey: string;

  @Column({ type: 'varchar', nullable: true }) url: string;
  @Column({ type: 'varchar', nullable: true }) source: string; // 'duckduckgo' | 'google' | 'manual'
  @Column({ default: false }) notFound: boolean;

  @CreateDateColumn() createdAt: Date;
}
