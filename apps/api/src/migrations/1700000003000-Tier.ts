import { MigrationInterface, QueryRunner } from 'typeorm';

export class Tier1700000003000 implements MigrationInterface {
  name = 'Tier1700000003000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS tier varchar NOT NULL DEFAULT 'STANDARD'`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS tier`);
  }
}
