import { MigrationInterface, QueryRunner } from 'typeorm';

export class WatchlistSchedule1700000015000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    // Per-item check frequency on watchlist
    await qr.query(`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS check_frequency VARCHAR(16) DEFAULT 'WEEKLY'`);
    await qr.query(`ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS next_check_at TIMESTAMPTZ`);
    // Notification email on users (for email delivery)
    await qr.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_email VARCHAR(255)`);
    await qr.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_settings JSONB DEFAULT '{}'`);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE users DROP COLUMN IF EXISTS notification_settings`);
    await qr.query(`ALTER TABLE users DROP COLUMN IF EXISTS notification_email`);
    await qr.query(`ALTER TABLE watchlist DROP COLUMN IF EXISTS next_check_at`);
    await qr.query(`ALTER TABLE watchlist DROP COLUMN IF EXISTS check_frequency`);
  }
}
