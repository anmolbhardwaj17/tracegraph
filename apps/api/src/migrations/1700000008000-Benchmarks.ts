import { MigrationInterface, QueryRunner } from 'typeorm';

export class Benchmarks1700000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS investigation_benchmarks (
        id int PRIMARY KEY DEFAULT 1,
        "totalInvestigations" int NOT NULL DEFAULT 0,
        "avgScore" float NOT NULL DEFAULT 0,
        "medianScore" float NOT NULL DEFAULT 0,
        "lowPct" float NOT NULL DEFAULT 0,
        "mediumPct" float NOT NULL DEFAULT 0,
        "highPct" float NOT NULL DEFAULT 0,
        "criticalPct" float NOT NULL DEFAULT 0,
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`INSERT INTO investigation_benchmarks (id) VALUES (1) ON CONFLICT DO NOTHING`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS investigation_benchmarks');
  }
}
