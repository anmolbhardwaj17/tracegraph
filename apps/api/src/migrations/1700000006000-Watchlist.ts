import { MigrationInterface, QueryRunner } from 'typeorm';

export class Watchlist1700000006000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS watchlist (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "companyNumber" varchar NOT NULL UNIQUE,
        "companyName" varchar NOT NULL,
        "lastRiskScore" float,
        "lastInvestigationId" varchar,
        "lastInvestigatedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS watchlist');
  }
}
