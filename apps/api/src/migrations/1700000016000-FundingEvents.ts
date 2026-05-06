import { MigrationInterface, QueryRunner } from 'typeorm';

export class FundingEvents1700000016000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS funding_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        company_entity_id VARCHAR(100) NOT NULL,
        company_name VARCHAR(255),
        event_type VARCHAR(50) NOT NULL,
        event_date DATE,
        amount_minor BIGINT,
        currency VARCHAR(10) DEFAULT 'GBP',
        share_class VARCHAR(100),
        details JSONB,
        source VARCHAR(50) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_fe_investigation ON funding_events(investigation_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_fe_company ON funding_events(company_entity_id)`);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fe_unique
        ON funding_events(investigation_id, company_entity_id, event_type, event_date, COALESCE(amount_minor, -1))
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS funding_events`);
  }
}
