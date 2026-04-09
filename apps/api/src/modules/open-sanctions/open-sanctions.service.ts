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
