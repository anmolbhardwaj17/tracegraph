import { MigrationInterface, QueryRunner } from 'typeorm';

export class ApiKeys1700000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "keyHash" varchar NOT NULL UNIQUE,
        name varchar NOT NULL,
        "rateLimit" int NOT NULL DEFAULT 100,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS api_keys');
  }
}
