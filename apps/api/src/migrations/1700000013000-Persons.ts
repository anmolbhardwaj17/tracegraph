import { MigrationInterface, QueryRunner } from 'typeorm';

export class Persons1700000013000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE IF NOT EXISTS persons (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        canonical_name VARCHAR(255) NOT NULL,
        normalized_name VARCHAR(255) NOT NULL,
        dob_month INT,
        dob_year INT,
        nationality VARCHAR(100),
        investigation_count INT NOT NULL DEFAULT 1,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        signals JSONB,
        metadata JSONB
      )
    `);

    await qr.query(`CREATE INDEX IF NOT EXISTS idx_persons_normalized_name ON persons(normalized_name)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_persons_dob ON persons(dob_year, dob_month)`);

    await qr.query(`
      CREATE TABLE IF NOT EXISTS person_appointments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        person_id UUID NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
        investigation_id UUID NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
        company_entity_id VARCHAR(100) NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        company_status VARCHAR(50),
        company_jurisdiction VARCHAR(20),
        role VARCHAR(100),
        appointed_on DATE,
        resigned_on DATE,
        source VARCHAR(50),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await qr.query(`CREATE INDEX IF NOT EXISTS idx_pa_person_id ON person_appointments(person_id)`);
    await qr.query(`CREATE INDEX IF NOT EXISTS idx_pa_investigation ON person_appointments(investigation_id)`);
    await qr.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pa_unique
        ON person_appointments(person_id, investigation_id, company_entity_id)
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS person_appointments`);
    await qr.query(`DROP TABLE IF EXISTS persons`);
  }
}
