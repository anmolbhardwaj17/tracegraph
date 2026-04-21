import { MigrationInterface, QueryRunner } from 'typeorm';

export class GermanCompanies1700000011000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS german_companies (
        company_number VARCHAR(50) PRIMARY KEY,
        name VARCHAR(500) NOT NULL,
        status VARCHAR(50),
        registered_address TEXT,
        registered_office VARCHAR(200),
        federal_state VARCHAR(100),
        register_type VARCHAR(10),
        register_number VARCHAR(50),
        native_company_number VARCHAR(100),
        officers JSONB DEFAULT '[]',
        retrieved_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_german_co_name ON german_companies USING gin(name gin_trgm_ops)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_german_co_state ON german_companies (federal_state)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_german_co_status ON german_companies (status)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS german_companies');
  }
}
