import { MigrationInterface, QueryRunner } from 'typeorm';

export class Pipeline1700000014000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    // Add deal pipeline columns to investigations
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS deal_stage VARCHAR(32)`);
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS deal_priority VARCHAR(16) DEFAULT 'NORMAL'`);
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS deal_size_estimate BIGINT`);
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS deal_owner_id UUID`);
    await qr.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS deal_owner_name VARCHAR(255)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_inv_deal_stage ON investigations(deal_stage)`);

    // Investigation notes (multiple notes per deal)
    await qr.query(`
      CREATE TABLE IF NOT EXISTS investigation_notes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        author_name VARCHAR(255),
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_inv_notes_inv ON investigation_notes(investigation_id)`);

    // Investigation activity log (stage changes, priority changes, key events)
    await qr.query(`
      CREATE TABLE IF NOT EXISTS investigation_activity (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        actor_name VARCHAR(255),
        action VARCHAR(64) NOT NULL,
        payload JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_inv_activity_inv ON investigation_activity(investigation_id)`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS investigation_activity`);
    await qr.query(`DROP TABLE IF EXISTS investigation_notes`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS deal_owner_name`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS deal_owner_id`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS deal_size_estimate`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS deal_priority`);
    await qr.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS deal_stage`);
  }
}
