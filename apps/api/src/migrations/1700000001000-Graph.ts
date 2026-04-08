import { MigrationInterface, QueryRunner } from 'typeorm';

export class Graph1700000001000 implements MigrationInterface {
  name = 'Graph1700000001000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE graph_nodes (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "investigationId" uuid NOT NULL,
        "entityType" varchar NOT NULL,
        "entityId" varchar NOT NULL,
        label varchar NOT NULL,
        metadata jsonb
      )
    `);
    await q.query(`CREATE INDEX idx_graph_nodes_inv ON graph_nodes("investigationId")`);
    await q.query(
      `CREATE UNIQUE INDEX idx_graph_nodes_unique ON graph_nodes("investigationId", "entityType", "entityId")`,
    );

    await q.query(`
      CREATE TABLE graph_edges (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "investigationId" uuid NOT NULL,
        "sourceNodeId" uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        "targetNodeId" uuid NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
        "relationshipType" varchar NOT NULL,
        metadata jsonb
      )
    `);
    await q.query(`CREATE INDEX idx_graph_edges_inv ON graph_edges("investigationId")`);
    await q.query(
      `CREATE UNIQUE INDEX idx_graph_edges_unique ON graph_edges("investigationId", "sourceNodeId", "targetNodeId", "relationshipType")`,
    );

    // Add EXPANDING status (just documentation; column is varchar)
    await q.query(`ALTER TABLE investigations ADD COLUMN IF NOT EXISTS "progress" jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE investigations DROP COLUMN IF EXISTS "progress"`);
    await q.query(`DROP TABLE IF EXISTS graph_edges`);
    await q.query(`DROP TABLE IF EXISTS graph_nodes`);
  }
}
