import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { SanctionsEntity } from './entities/sanctions-entity.entity';

@Injectable()
export class OpenSanctionsService {
  private readonly logger = new Logger(OpenSanctionsService.name);

  constructor(
    @InjectRepository(SanctionsEntity)
    private readonly repo: Repository<SanctionsEntity>,
  ) {}

  /**
   * Ingest a FollowTheMoney JSON-lines file. Each line is one entity:
   *   { "id": "...", "schema": "Person", "properties": { "name": [...], ... } }
   */
  async ingestFromFile(filePath: string): Promise<{ inserted: number }> {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Sanctions file not found: ${filePath}`);
    }
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    let inserted = 0;
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        await this.repo.upsert(this.toEntity(e), ['id']);
        inserted++;
      } catch (err: any) {
        this.logger.warn(`Skipped malformed line: ${err?.message}`);
      }
    }
    this.logger.log(`Ingested ${inserted} OpenSanctions entities from ${filePath}`);
    return { inserted };
  }

  async ingestSampleIfEmpty(): Promise<void> {
    const count = await this.repo.count();
    if (count > 0) return;
    const sample = path.join(__dirname, '..', '..', '..', 'data', 'opensanctions-sample.jsonl');
    if (fs.existsSync(sample)) {
      await this.ingestFromFile(sample);
    }
  }

  private toEntity(e: any): Partial<SanctionsEntity> {
    const props = e.properties || {};
    const names: string[] = [
      ...(props.name || []),
      ...(props.alias || []),
      ...(props.firstName || []),
      ...(props.lastName || []),
    ];
    return {
      id: e.id,
      schemaType: e.schema || 'Thing',
      names,
      birthDates: props.birthDate || [],
      nationalities: props.nationality || [],
      countries: props.country || [],
      topics: props.topics || [],
      datasets: e.datasets || [],
      properties: props,
      sourceUrl: `https://www.opensanctions.org/entities/${e.id}/`,
      searchText: names.join(' ').toLowerCase(),
    };
  }

  /**
   * Batch fuzzy search: insert all names into a temp table, run ONE join.
   * Returns a map of lowercase name -> array of matching entities.
   */
  async batchSearchByNames(names: string[]): Promise<Map<string, Array<{ entity: SanctionsEntity; similarity: number }>>> {
    const result = new Map<string, Array<{ entity: SanctionsEntity; similarity: number }>>();
    if (names.length === 0) return result;

    try {
      const mgr = this.repo.manager;
      await mgr.query(`CREATE TEMP TABLE IF NOT EXISTS _batch_names (name text NOT NULL)`);
      await mgr.query(`TRUNCATE _batch_names`);

      // Insert in chunks of 500
      for (let i = 0; i < names.length; i += 500) {
        const chunk = names.slice(i, i + 500);
        const values = chunk.map((n) => `(${mgr.connection.driver.escape(n.toLowerCase().trim())})`).join(',');
        await mgr.query(`INSERT INTO _batch_names (name) VALUES ${values}`);
      }

      await mgr.query(`SET LOCAL pg_trgm.similarity_threshold = 0.15`);
      const rows = await mgr.query(`
        SELECT s.*, bn.name AS query_name, similarity(s."searchText", bn.name) AS sim
        FROM sanctions_entities s
        JOIN _batch_names bn ON s."searchText" % bn.name
        WHERE similarity(s."searchText", bn.name) > 0.15
        ORDER BY sim DESC
      `);

      for (const r of rows) {
        const key = r.query_name;
        const list = result.get(key) || [];
        if (list.length < 5) {
          list.push({
            entity: {
              id: r.id, schemaType: r.schemaType, names: r.names,
              birthDates: r.birthDates, nationalities: r.nationalities,
              countries: r.countries, topics: r.topics, datasets: r.datasets,
              properties: r.properties, sourceUrl: r.sourceUrl, searchText: r.searchText,
            } as SanctionsEntity,
            similarity: parseFloat(r.sim),
          });
        }
        result.set(key, list);
      }

      await mgr.query(`DROP TABLE IF EXISTS _batch_names`);
    } catch (e: any) {
      this.logger.warn(`Batch sanctions search failed, falling back to sequential: ${e?.message}`);
    }
    return result;
  }

  /** Fuzzy search by name using trigram similarity (pg_trgm). */
  async searchByName(name: string, limit = 10): Promise<Array<{ entity: SanctionsEntity; similarity: number }>> {
    const q = name.toLowerCase().trim();
    if (!q) return [];
    try {
      // Loosen the pg_trgm pre-filter so the scoring stage (which has its
      // own threshold) sees more candidates. The actual match decision
      // happens in EntityResolutionService.classify, not here.
      await this.repo.query(`SET LOCAL pg_trgm.similarity_threshold = 0.15`);
      const rows = await this.repo.query(
        `SELECT *, similarity("searchText", $1) AS sim
         FROM sanctions_entities
         WHERE "searchText" % $1
         ORDER BY sim DESC
         LIMIT $2`,
        [q, limit],
      );
      return rows.map((r: any) => ({
        entity: {
          id: r.id,
          schemaType: r.schemaType,
          names: r.names,
          birthDates: r.birthDates,
          nationalities: r.nationalities,
          countries: r.countries,
          topics: r.topics,
          datasets: r.datasets,
          properties: r.properties,
          sourceUrl: r.sourceUrl,
          searchText: r.searchText,
        } as SanctionsEntity,
        similarity: parseFloat(r.sim),
      }));
    } catch {
      // Fallback (no pg_trgm in test sqlite, etc.)
      const all = await this.repo.find({ take: 1000 });
      return all
        .filter((e) => e.searchText?.includes(q))
        .slice(0, limit)
        .map((entity) => ({ entity, similarity: 1 }));
    }
  }
}
