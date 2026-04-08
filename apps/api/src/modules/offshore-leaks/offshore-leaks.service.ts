import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { OffshoreEntity } from './entities/offshore-entity.entity';
import { OffshoreOfficer } from './entities/offshore-officer.entity';
import { OffshoreIntermediary } from './entities/offshore-intermediary.entity';
import { OffshoreRelationship } from './entities/offshore-relationship.entity';

/** Minimal CSV parser handling quoted fields. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

@Injectable()
export class OffshoreLeaksService {
  private readonly logger = new Logger(OffshoreLeaksService.name);

  constructor(
    @InjectRepository(OffshoreEntity) private readonly entities: Repository<OffshoreEntity>,
    @InjectRepository(OffshoreOfficer) private readonly officers: Repository<OffshoreOfficer>,
    @InjectRepository(OffshoreIntermediary) private readonly intermediaries: Repository<OffshoreIntermediary>,
    @InjectRepository(OffshoreRelationship) private readonly relationships: Repository<OffshoreRelationship>,
  ) {}

  async ingestEntities(filePath: string) {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    for (const r of rows) {
      await this.entities.upsert({
        id: r.node_id || r.id,
        name: r.name,
        jurisdiction: r.jurisdiction || r.jurisdiction_description,
        country: r.country_codes || r.country,
        incorporationDate: r.incorporation_date,
        inactivationDate: r.inactivation_date,
        status: r.status,
        sourceid: r.sourceID,
        searchText: (r.name || '').toLowerCase(),
      }, ['id']);
    }
    this.logger.log(`Ingested ${rows.length} offshore entities`);
    return rows.length;
  }

  async ingestOfficers(filePath: string) {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    for (const r of rows) {
      await this.officers.upsert({
        id: r.node_id || r.id,
        name: r.name,
        country: r.country_codes || r.country,
        sourceid: r.sourceID,
        searchText: (r.name || '').toLowerCase(),
      }, ['id']);
    }
    this.logger.log(`Ingested ${rows.length} offshore officers`);
    return rows.length;
  }

  async ingestIntermediaries(filePath: string) {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    for (const r of rows) {
      await this.intermediaries.upsert({
        id: r.node_id || r.id,
        name: r.name,
        country: r.country_codes || r.country,
        status: r.status,
        sourceid: r.sourceID,
        searchText: (r.name || '').toLowerCase(),
      }, ['id']);
    }
    return rows.length;
  }

  async ingestRelationships(filePath: string) {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    for (const r of rows) {
      await this.relationships.upsert({
        id: `${r.node_id_start}-${r.node_id_end}-${r.rel_type}`,
        sourceId: r.node_id_start,
        targetId: r.node_id_end,
        relationshipType: r.rel_type || r.link,
        startDate: r.start_date,
        endDate: r.end_date,
        sourceid: r.sourceID,
      }, ['id']);
    }
    return rows.length;
  }

  async ingestSampleIfEmpty() {
    const count = await this.entities.count();
    if (count > 0) return;
    const dir = path.join(__dirname, '..', '..', '..', 'data', 'offshore-leaks');
    if (!fs.existsSync(dir)) return;
    const files = ['entities.csv', 'officers.csv', 'intermediaries.csv', 'relationships.csv'];
    const fns = [
      this.ingestEntities.bind(this),
      this.ingestOfficers.bind(this),
      this.ingestIntermediaries.bind(this),
      this.ingestRelationships.bind(this),
    ];
    for (let i = 0; i < files.length; i++) {
      const fp = path.join(dir, files[i]);
      if (fs.existsSync(fp)) await fns[i](fp);
    }
  }

  async searchEntitiesByName(name: string, limit = 10) {
    return this.trgmSearch('offshore_entities', name, limit);
  }
  async searchOfficersByName(name: string, limit = 10) {
    return this.trgmSearch('offshore_officers', name, limit);
  }

  private async trgmSearch(table: string, name: string, limit: number) {
    const q = name.toLowerCase().trim();
    if (!q) return [];
    try {
      const rows = await this.entities.query(
        `SELECT *, similarity("searchText", $1) AS sim FROM ${table}
         WHERE "searchText" % $1 ORDER BY sim DESC LIMIT $2`,
        [q, limit],
      );
      return rows.map((r: any) => ({ entity: r, similarity: parseFloat(r.sim) }));
    } catch {
      return [];
    }
  }
}
