/* eslint-disable */
/**
 * Streams the OpenSanctions default dataset (~200k entities, ~250MB JSONL)
 * into the local sanctions_entities table. Idempotent: skips download if file
 * exists, batches DB writes, prints progress.
 *
 * Run from apps/api:
 *   npm run ingest:opensanctions
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import * as https from 'https';
import dataSource from '../data-source';
import { SanctionsEntity } from '../modules/open-sanctions/entities/sanctions-entity.entity';

const URL = 'https://data.opensanctions.org/datasets/latest/default/entities.ftm.json';
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'full');
const FILE = path.join(DATA_DIR, 'opensanctions-default.jsonl');
const BATCH_SIZE = 500;

async function downloadIfMissing(): Promise<void> {
  if (fs.existsSync(FILE)) {
    const stat = fs.statSync(FILE);
    console.log(`✓ Using existing file: ${FILE} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log(`↓ Downloading from ${URL}`);
  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(FILE + '.tmp');
    let downloaded = 0;
    let lastLogged = 0;
    https.get(URL, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        // follow redirect
        https.get(res.headers.location!, (r2) => pipe(r2));
      } else {
        pipe(res);
      }
      function pipe(stream: any) {
        const totalMB = parseInt(stream.headers['content-length'] || '0', 10) / 1024 / 1024;
        stream.on('data', (chunk: Buffer) => {
          downloaded += chunk.length;
          const mb = downloaded / 1024 / 1024;
          if (mb - lastLogged > 10) {
            lastLogged = mb;
            const pct = totalMB > 0 ? ` (${((mb / totalMB) * 100).toFixed(0)}%)` : '';
            process.stdout.write(`  downloaded ${mb.toFixed(0)} MB${pct}\r`);
          }
        });
        stream.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.renameSync(FILE + '.tmp', FILE);
          process.stdout.write('\n');
          resolve();
        });
      }
    }).on('error', reject);
  });
}

function toEntity(raw: any): Partial<SanctionsEntity> | null {
  if (!raw?.id) return null;
  const props = raw.properties || {};
  const names: string[] = [
    ...(props.name || []),
    ...(props.alias || []),
    ...(props.firstName || []),
    ...(props.lastName || []),
    ...(props.fatherName || []),
  ];
  return {
    id: raw.id,
    schemaType: raw.schema || 'Thing',
    names,
    birthDates: props.birthDate || [],
    nationalities: props.nationality || [],
    countries: props.country || [],
    topics: props.topics || [],
    datasets: raw.datasets || [],
    properties: props,
    sourceUrl: `https://www.opensanctions.org/entities/${raw.id}/`,
    searchText: names.join(' ').toLowerCase(),
  };
}

async function run() {
  await downloadIfMissing();

  console.log('→ Connecting to database…');
  await dataSource.initialize();
  const repo = dataSource.getRepository(SanctionsEntity);

  const initialCount = await repo.count();
  console.log(`  current sanctions_entities rows: ${initialCount.toLocaleString()}`);

  console.log('→ Streaming and ingesting…');
  const stream = fs.createReadStream(FILE);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  let batch: Partial<SanctionsEntity>[] = [];
  let inserted = 0;
  let skipped = 0;
  const t0 = Date.now();

  async function flush() {
    if (batch.length === 0) return;
    try {
      await repo.upsert(batch as any, ['id']);
      inserted += batch.length;
    } catch (e: any) {
      console.warn(`\n  batch insert failed: ${e.message}`);
      skipped += batch.length;
    }
    batch = [];
  }

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;
    let raw: any;
    try {
      raw = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    const entity = toEntity(raw);
    if (!entity) {
      skipped++;
      continue;
    }
    batch.push(entity);
    if (batch.length >= BATCH_SIZE) {
      await flush();
      if (inserted % 5000 === 0) {
        const elapsed = (Date.now() - t0) / 1000;
        const rate = inserted / Math.max(elapsed, 1);
        process.stdout.write(
          `  ingested ${inserted.toLocaleString()} entities (${rate.toFixed(0)}/s)…\r`,
        );
      }
    }
  }
  await flush();
  process.stdout.write('\n');

  const finalCount = await repo.count();
  const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✓ Done in ${elapsed}s`);
  console.log(`  lines read:  ${lineNum.toLocaleString()}`);
  console.log(`  inserted:    ${inserted.toLocaleString()}`);
  console.log(`  skipped:     ${skipped.toLocaleString()}`);
  console.log(`  rows now:    ${finalCount.toLocaleString()} (was ${initialCount.toLocaleString()})`);

  await dataSource.destroy();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
