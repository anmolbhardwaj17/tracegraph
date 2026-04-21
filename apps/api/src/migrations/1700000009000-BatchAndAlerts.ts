import { MigrationInterface, QueryRunner } from 'typeorm';

export class BatchAndAlerts1700000009000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Batch screening table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS batch_screens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
        tier VARCHAR(10) NOT NULL DEFAULT 'QUICK',
        jurisdiction VARCHAR(10) NOT NULL DEFAULT 'us',
        total_companies INT NOT NULL DEFAULT 0,
        completed INT NOT NULL DEFAULT 0,
        failed INT NOT NULL DEFAULT 0,
        investigation_ids JSONB DEFAULT '[]',
        results JSONB DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
      )
    `);

    // Watchlist alerts table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS watchlist_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_number VARCHAR(50) NOT NULL,
        company_name VARCHAR(255),
        alert_type VARCHAR(50) NOT NULL,
        severity VARCHAR(10) NOT NULL DEFAULT 'LOW',
        title VARCHAR(500) NOT NULL,
        description TEXT,
        metadata JSONB DEFAULT '{}',
        read BOOLEAN NOT NULL DEFAULT false,
        dismissed BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_watchlist_alerts_company ON watchlist_alerts (company_number)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_watchlist_alerts_read ON watchlist_alerts (read, created_at DESC)`);

    // Add jurisdiction column to watchlist if not exists
    await queryRunner.query(`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS jurisdiction VARCHAR(10) DEFAULT 'gb'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS batch_screens');
    await queryRunner.query('DROP TABLE IF EXISTS watchlist_alerts');
  }
}
