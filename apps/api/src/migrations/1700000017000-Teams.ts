import { MigrationInterface, QueryRunner } from 'typeorm';

export class Teams1700000017000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    // Teams
    await qr.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(100) UNIQUE,
        owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Team members (owner / admin / member / viewer)
    await qr.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        invited_email VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'member',
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        invited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        joined_at TIMESTAMPTZ,
        UNIQUE(team_id, user_id),
        UNIQUE(team_id, invited_email)
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tm_team ON team_members(team_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_tm_email ON team_members(invited_email)`);

    // Investigation comments
    await qr.query(`
      CREATE TABLE IF NOT EXISTS investigation_comments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        author_id UUID REFERENCES users(id) ON DELETE SET NULL,
        author_name VARCHAR(255),
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_ic_inv ON investigation_comments(investigation_id)`);

    // Share token on investigations
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS share_token UUID`);
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT false`);
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL`);
    await qr.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_share_token ON investigations(share_token) WHERE share_token IS NOT NULL`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_inv_team ON investigations(team_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS team_id`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS share_enabled`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS share_token`);
    await qr.query(`DROP TABLE IF EXISTS investigation_comments`);
    await qr.query(`DROP TABLE IF EXISTS team_members`);
    await qr.query(`DROP TABLE IF EXISTS teams`);
  }
}
