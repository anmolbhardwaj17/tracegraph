/* eslint-disable */
/**
 * Ingests the full ICIJ OffshoreLeaks dataset (Panama / Paradise / Pandora /
 * Bahamas) into the local offshore_* tables.
 *
 * SETUP (one time):
 *   1. Visit https://offshoreleaks.icij.org/pages/database
 *   2. Click "Download the data" → accept terms → download the ZIP
 *   3. Extract the CSVs into apps/api/data/full/offshore-leaks/
 *      Expected files (names may vary slightly between releases):
 *        - nodes-entities.csv
 *        - nodes-officers.csv
 *        - nodes-intermediaries.csv
 *        - relationships.csv
 *
 * Then run from apps/api:
 *   npm run ingest:offshore
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import dataSource from '../data-source';
import { OffshoreEntity } from '../modules/offshore-leaks/entities/offshore-entity.entity';
import { OffshoreOfficer } from '../modules/offshore-leaks/entities/offshore-officer.entity';
import { OffshoreIntermediary } from '../modules/offshore-leaks/entities/offshore-intermediary.entity';
import { OffshoreRelationship } from '../modules/offshore-leaks/entities/offshore-relationship.entity';

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'full', 'offshore-leaks');
const BATCH_SIZE = 1000;

// File-name patterns to look for. ICIJ filenames vary across releases.
const ENTITY_FILES = ['nodes-entities.csv', 'entities.csv'];
const OFFICER_FILES = ['nodes-officers.csv', 'officers.csv'];
const INTERMEDIARY_FILES = ['nodes-intermediaries.csv', 'intermediaries.csv'];
const RELATIONSHIP_FILES = ['relationships.csv', 'links.csv'];

function findFile(candidates: string[]): string | null {
  for (const c of candidates) {
    const p = path.join(DATA_DIR, c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Streaming CSV parser handling quoted fields. */
async function* streamCsv(filePath: string): AsyncGenerator<Record<string, string>> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers: string[] | null = null;
  for await (const line of rl) {
    const cells = splitCsvLine(line);
    if (!headers) {
      headers = cells.map((c) => c.trim());
      continue;
    }
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    yield row;
  }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
    } else if (c === ',' && !inQ) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function ingest<T>(
  filePath: string,
  label: string,
  repo: any,
  conflict: string[],
  rowMap: (r: Record<string, string>) => any | null,
) {
  console.log(`→ Ingesting ${label} from ${path.basename(filePath)}`);
  let batch: any[] = [];
  let processed = 0;
  let inserted = 0;
  const t0 = Date.now();

  async function flush() {
    if (batch.length === 0) return;
    try {
      await repo.upsert(batch, conflict);
      inserted += batch.length;
    } catch (e: any) {
      console.warn(`\n  batch failed: ${e.message}`);
    }
    batch = [];
  }

  for await (const row of streamCsv(filePath)) {
    const mapped = rowMap(row);
    if (!mapped) continue;
    batch.push(mapped);
    processed++;
    if (batch.length >= BATCH_SIZE) {
      await flush();
      if (inserted % 10000 === 0) {
        const rate = inserted / Math.max((Date.now() - t0) / 1000, 1);
        process.stdout.write(`  ${inserted.toLocaleString()} (${rate.toFixed(0)}/s)\r`);
      }
    }
  }
  await flush();
  process.stdout.write('\n');
  console.log(`  ${label}: ${inserted.toLocaleString()} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function run() {
  if (!fs.existsSync(DATA_DIR)) {
    console.error(`✗ Directory not found: ${DATA_DIR}`);
    console.error('  See setup instructions in this file.');
    process.exit(1);
  }

  await dataSource.initialize();

  const entityFile = findFile(ENTITY_FILES);
  const officerFile = findFile(OFFICER_FILES);
  const intermediaryFile = findFile(INTERMEDIARY_FILES);
  const relationshipFile = findFile(RELATIONSHIP_FILES);

  if (!entityFile && !officerFile && !intermediaryFile && !relationshipFile) {
    console.error(`✗ No CSV files found in ${DATA_DIR}`);
    console.error('  Expected files: nodes-entities.csv, nodes-officers.csv, nodes-intermediaries.csv, relationships.csv');
    process.exit(1);
  }

  if (entityFile) {
    await ingest(entityFile, 'entities', dataSource.getRepository(OffshoreEntity), ['id'], (r) => {
      const id = r.node_id || r.id;
      if (!id) return null;
      return {
        id,
        name: r.name || '',
        jurisdiction: r.jurisdiction || r.jurisdiction_description,
        country: r.country_codes || r.country,
        incorporationDate: r.incorporation_date,
        inactivationDate: r.inactivation_date,
        status: r.status,
        sourceid: r.sourceID,
        searchText: (r.name || '').toLowerCase(),
      };
    });
  }

  if (officerFile) {
    await ingest(officerFile, 'officers', dataSource.getRepository(OffshoreOfficer), ['id'], (r) => {
      const id = r.node_id || r.id;
      if (!id) return null;
      return {
        id,
        name: r.name || '',
        country: r.country_codes || r.country,
        sourceid: r.sourceID,
        searchText: (r.name || '').toLowerCase(),
      };
    });
  }

  if (intermediaryFile) {
    await ingest(intermediaryFile, 'intermediaries', dataSource.getRepository(OffshoreIntermediary), ['id'], (r) => {
      const id = r.node_id || r.id;
      if (!id) return null;
      return {
        id,
        name: r.name || '',
        country: r.country_codes || r.country,
        status: r.status,
        sourceid: r.sourceID,
        searchText: (r.name || '').toLowerCase(),
      };
    });
  }

  if (relationshipFile) {
    await ingest(relationshipFile, 'relationships', dataSource.getRepository(OffshoreRelationship), ['id'], (r) => {
      if (!r.node_id_start || !r.node_id_end) return null;
      return {
        id: `${r.node_id_start}-${r.node_id_end}-${r.rel_type || r.link || ''}`,
        sourceId: r.node_id_start,
        targetId: r.node_id_end,
        relationshipType: r.rel_type || r.link,
        startDate: r.start_date,
        endDate: r.end_date,
        sourceid: r.sourceID,
      };
    });
  }

  const counts = await Promise.all([
    dataSource.getRepository(OffshoreEntity).count(),
    dataSource.getRepository(OffshoreOfficer).count(),
    dataSource.getRepository(OffshoreIntermediary).count(),
    dataSource.getRepository(OffshoreRelationship).count(),
  ]);
  console.log(`\n✓ Final counts:`);
  console.log(`  entities:        ${counts[0].toLocaleString()}`);
  console.log(`  officers:        ${counts[1].toLocaleString()}`);
  console.log(`  intermediaries:  ${counts[2].toLocaleString()}`);
  console.log(`  relationships:   ${counts[3].toLocaleString()}`);

  await dataSource.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
