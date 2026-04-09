import { MigrationInterface, QueryRunner } from 'typeorm';

export class Geocode1700000004000 implements MigrationInterface {
  name = 'Geocode1700000004000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE geocode_cache (
        "addressKey" varchar PRIMARY KEY,
        lat double precision,
        lng double precision,
        "displayName" varchar,
        "notFound" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS geocode_cache`);
  }
}
