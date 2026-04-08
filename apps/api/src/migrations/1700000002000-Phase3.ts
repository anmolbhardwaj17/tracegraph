import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase31700000002000 implements MigrationInterface {
  name = 'Phase31700000002000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // OpenSanctions
    await q.query(`
      CREATE TABLE sanctions_entities (
        id varchar PRIMARY KEY,
        "schemaType" varchar NOT NULL,
        names text[] DEFAULT '{}',
        "birthDates" text[] DEFAULT '{}',
        nationalities text[] DEFAULT '{}',
        countries text[] DEFAULT '{}',
        topics text[] DEFAULT '{}',
        datasets text[] DEFAULT '{}',
        properties jsonb,
        "sourceUrl" varchar,
        "searchText" varchar
      )
    `);
    await q.query(`CREATE INDEX idx_sanctions_schema ON sanctions_entities("schemaType")`);
    await q.query(`CREATE INDEX idx_sanctions_search_trgm ON sanctions_entities USING gin("searchText" gin_trgm_ops)`);

    // ICIJ OffshoreLeaks
    await q.query(`
      CREATE TABLE offshore_entities (
        id varchar PRIMARY KEY,
        name varchar NOT NULL,
        jurisdiction varchar,
        country varchar,
        "incorporationDate" varchar,
        "inactivationDate" varchar,
        status varchar,
        sourceid varchar,
        "searchText" varchar
      )
    `);
    await q.query(`CREATE INDEX idx_offshore_entities_trgm ON offshore_entities USING gin("searchText" gin_trgm_ops)`);

    await q.query(`
      CREATE TABLE offshore_officers (
        id varchar PRIMARY KEY,
        name varchar NOT NULL,
        country varchar,
        sourceid varchar,
        "searchText" varchar
      )
    `);
    await q.query(`CREATE INDEX idx_offshore_officers_trgm ON offshore_officers USING gin("searchText" gin_trgm_ops)`);

    await q.query(`
      CREATE TABLE offshore_intermediaries (
        id varchar PRIMARY KEY,
        name varchar NOT NULL,
        country varchar,
        status varchar,
        sourceid varchar,
        "searchText" varchar
      )
    `);
    await q.query(`CREATE INDEX idx_offshore_intermediaries_trgm ON offshore_intermediaries USING gin("searchText" gin_trgm_ops)`);

    await q.query(`
      CREATE TABLE offshore_relationships (
        id varchar PRIMARY KEY,
        "sourceId" varchar NOT NULL,
        "targetId" varchar NOT NULL,
        "relationshipType" varchar,
        "startDate" varchar,
        "endDate" varchar,
        sourceid varchar
      )
    `);
    await q.query(`CREATE INDEX idx_offshore_rel_source ON offshore_relationships("sourceId")`);
    await q.query(`CREATE INDEX idx_offshore_rel_target ON offshore_relationships("targetId")`);

    // Entity matches
    await q.query(`
      CREATE TABLE entity_matches (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "investigationId" uuid NOT NULL,
        "sourceEntityType" varchar NOT NULL,
        "sourceEntityId" varchar NOT NULL,
        "matchedSource" varchar NOT NULL,
        "matchedEntityId" varchar NOT NULL,
        "confidenceScore" int NOT NULL,
        "matchReasons" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_entity_matches_inv ON entity_matches("investigationId")`);

    // Add proximity to graph nodes
    await q.query(`ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS "proximityScore" varchar`);
    await q.query(`ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS "proximityHops" int`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE graph_nodes DROP COLUMN IF EXISTS "proximityHops"`);
    await q.query(`ALTER TABLE graph_nodes DROP COLUMN IF EXISTS "proximityScore"`);
    await q.query(`DROP TABLE IF EXISTS entity_matches`);
    await q.query(`DROP TABLE IF EXISTS offshore_relationships`);
    await q.query(`DROP TABLE IF EXISTS offshore_intermediaries`);
    await q.query(`DROP TABLE IF EXISTS offshore_officers`);
    await q.query(`DROP TABLE IF EXISTS offshore_entities`);
    await q.query(`DROP TABLE IF EXISTS sanctions_entities`);
  }
}
