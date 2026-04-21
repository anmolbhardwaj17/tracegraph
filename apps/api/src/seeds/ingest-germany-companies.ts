/**
 * German Company Data Ingestion Script.
 *
 * Downloads and ingests the OffeneRegister bulk JSONL file
 * containing ~3-4 million German companies with officers.
 *
 * Usage:
 *   npm run ingest:germany
 *   npx ts-node src/seeds/ingest-germany-companies.ts [path-to-jsonl-or-bz2]
 *
 * Data source: https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';

async function main() {
  const target = process.argv[2] || path.resolve(__dirname, '../../data/germany/de_companies.jsonl.bz2');

  if (!fs.existsSync(target)) {
    console.log(`
German company data not found at: ${target}

To download (260MB):
  curl -L "https://daten.offeneregister.de/de_companies_ocdata.jsonl.bz2" \\
    -o apps/api/data/germany/de_companies.jsonl.bz2

Then run: npm run ingest:germany
`);
    process.exit(0);
  }

  console.log(`Loading German companies from: ${target}`);
  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();

  // Ensure table exists
  await ds.query(`
    CREATE TABLE IF NOT EXISTS german_companies (
      company_number VARCHAR(50) PRIMARY KEY,
      name VARCHAR(500) NOT NULL,
      status VARCHAR(50),
      registered_address TEXT,
      registered_office VARCHAR(200),
      federal_state VARCHAR(100),
      register_type VARCHAR(10),
      register_number VARCHAR(50),
      native_company_number VARCHAR(100),
      officers JSONB DEFAULT '[]',
      retrieved_at TIMESTAMPTZ
    )
  `);

  let inserted = 0;
  let skipped = 0;
  let batch: any[] = [];
  const batchSize = 500;

  // Handle both .bz2 and plain .jsonl
  let lineStream: NodeJS.ReadableStream;
  if (target.endsWith('.bz2')) {
    const { execSync } = require('child_process');
    // Check if bunzip2 is available
    try { execSync('which bunzip2'); } catch {
      console.error('bunzip2 not found. Install bzip2 or decompress manually.');
      process.exit(1);
    }
    const { spawn } = require('child_process');
    const bz2 = spawn('bunzip2', ['-c', target]);
    lineStream = bz2.stdout;
  } else {
    lineStream = createReadStream(target, { encoding: 'utf-8' });
  }

  const rl = createInterface({ input: lineStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const d = JSON.parse(line);
      if (!d.company_number || !d.name) { skipped++; continue; }

      batch.push({
        company_number: d.company_number,
        name: d.name,
        status: d.current_status || null,
        registered_address: d.registered_address || null,
        registered_office: d.all_attributes?.registered_office || null,
        federal_state: d.all_attributes?.federal_state || null,
        register_type: d.all_attributes?._registerArt || null,
        register_number: d.all_attributes?._registerNummer || null,
        native_company_number: d.all_attributes?.native_company_number || null,
        officers: JSON.stringify(d.officers || []),
        retrieved_at: d.retrieved_at || null,
      });

      if (batch.length >= batchSize) {
        await insertBatch(ds, batch);
        inserted += batch.length;
        batch = [];
        if (inserted % 50000 === 0) {
          console.log(`  ${inserted.toLocaleString()} companies inserted...`);
        }
      }
    } catch { skipped++; }
  }

  if (batch.length > 0) {
    await insertBatch(ds, batch);
    inserted += batch.length;
  }

  // Create indexes
  console.log('Creating indexes...');
  await ds.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_german_co_name ON german_companies USING gin(name gin_trgm_ops)`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_german_co_state ON german_companies (federal_state)`).catch(() => {});

  console.log(`\nDone: ${inserted.toLocaleString()} companies, ${skipped.toLocaleString()} skipped`);
  await ds.destroy();
}

async function insertBatch(ds: DataSource, batch: any[]): Promise<void> {
  const values: string[] = [];
  const params: any[] = [];
  let idx = 1;

  for (const r of batch) {
    values.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++}::jsonb,$${idx++})`);
    params.push(
      r.company_number, r.name, r.status, r.registered_address,
      r.registered_office, r.federal_state, r.register_type,
      r.register_number, r.native_company_number, r.officers, r.retrieved_at,
    );
  }

  await ds.query(
    `INSERT INTO german_companies (company_number, name, status, registered_address, registered_office, federal_state, register_type, register_number, native_company_number, officers, retrieved_at)
     VALUES ${values.join(',')}
     ON CONFLICT (company_number) DO UPDATE SET name=EXCLUDED.name, status=EXCLUDED.status, officers=EXCLUDED.officers`,
    params,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
