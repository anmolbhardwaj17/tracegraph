import { MigrationInterface, QueryRunner } from 'typeorm';

export class LogoCache1700000005000 implements MigrationInterface {
  name = 'LogoCache1700000005000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE logo_cache (
        "nameKey" varchar PRIMARY KEY,
        url varchar,
        source varchar,
        "notFound" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS logo_cache`);
  }
}
