import { MigrationInterface, QueryRunner } from 'typeorm';

export class IndiaCompanies1700000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS india_companies (
        cin VARCHAR(21) PRIMARY KEY,
        company_name VARCHAR(500) NOT NULL,
        status VARCHAR(50),
        company_type VARCHAR(100),
        company_class VARCHAR(50),
        category VARCHAR(100),
        sub_category VARCHAR(100),
        date_of_registration DATE,
        authorized_capital BIGINT,
        paid_up_capital BIGINT,
        state VARCHAR(100),
        roc VARCHAR(100),
        activity_code VARCHAR(10),
        activity_description VARCHAR(500),
        registered_address TEXT,
        email VARCHAR(255),
        listed_status VARCHAR(20),
        last_agm_date DATE,
        balance_sheet_date DATE
      )
    `);

    // Indexes for fast search
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_india_co_name ON india_companies USING gin(to_tsvector('simple', company_name))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_india_co_state ON india_companies (state)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_india_co_status ON india_companies (status)`);

    // Enable trigram extension for fuzzy search (may already exist)
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_india_co_name_trgm ON india_companies USING gin(company_name gin_trgm_ops)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS india_companies');
  }
}
