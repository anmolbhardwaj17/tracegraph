import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await q.query(`
      CREATE TABLE addresses (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "addressLine1" varchar,
        "addressLine2" varchar,
        locality varchar,
        region varchar,
        "postalCode" varchar,
        country varchar,
        normalized varchar
      )
    `);

    await q.query(`
      CREATE TABLE companies (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "companyNumber" varchar NOT NULL,
        name varchar NOT NULL,
        status varchar,
        "incorporationDate" date,
        "companyType" varchar,
        jurisdiction varchar,
        "sicCodes" text[] DEFAULT '{}',
        address_id uuid REFERENCES addresses(id),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX idx_companies_number ON companies("companyNumber")`);

    await q.query(`
      CREATE TABLE officers (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "externalId" varchar NOT NULL,
        name varchar NOT NULL,
        nationality varchar,
        "dateOfBirthMonth" int,
        "dateOfBirthYear" int
      )
    `);
    await q.query(`CREATE INDEX idx_officers_external ON officers("externalId")`);

    await q.query(`
      CREATE TABLE company_officers (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
        officer_id uuid REFERENCES officers(id) ON DELETE CASCADE,
        role varchar,
        "appointedOn" date,
        "resignedOn" date
      )
    `);

    await q.query(`
      CREATE TABLE psc (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
        name varchar NOT NULL,
        kind varchar,
        "naturesOfControl" text[] DEFAULT '{}',
        "notifiedOn" date
      )
    `);

    await q.query(`
      CREATE TABLE investigations (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        query varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'QUEUED',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "completedAt" timestamptz,
        metadata jsonb
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS investigations`);
    await q.query(`DROP TABLE IF EXISTS psc`);
    await q.query(`DROP TABLE IF EXISTS company_officers`);
    await q.query(`DROP TABLE IF EXISTS officers`);
    await q.query(`DROP TABLE IF EXISTS companies`);
    await q.query(`DROP TABLE IF EXISTS addresses`);
  }
}
