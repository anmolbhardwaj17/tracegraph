/**
 * MCA Company Master Data Ingestion Script.
 *
 * Usage:
 *   1. Download company CSVs from MCA website:
 *      Data & Reports → Company/LLP Information → Incorporated Or Closed During The Month
 *      Download the monthly CSV files (120+ files available)
 *
 *   2. Place CSV file(s) in apps/api/data/india/
 *
 *   3. Run: npm run ingest:india
 *      Or:  npx ts-node src/seeds/ingest-india-companies.ts [path-to-csv-or-directory]
 *
 *   If a directory is provided, ALL .csv files in it will be ingested.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';

async function main() {
  const target = process.argv[2] || path.resolve(__dirname, '../../data/india');

  // Collect CSV files to process
  let csvFiles: string[] = [];

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    csvFiles = fs.readdirSync(target)
      .filter((f) => f.endsWith('.csv'))
      .map((f) => path.join(target, f))
      .sort();
  } else if (fs.existsSync(target) && target.endsWith('.csv')) {
    csvFiles = [target];
  }

  if (csvFiles.length === 0) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MCA Company Master Data Ingestion                          ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  No CSV files found.                                         ║
║                                                              ║
║  To ingest Indian company data:                              ║
║                                                              ║
║  1. Go to MCA website:                                       ║
║     mca.gov.in → Data & Reports → Company/LLP Information    ║
║     → Incorporated Or Closed During The Month                ║
║                                                              ║
║  2. Download the monthly CSV files                           ║
║                                                              ║
║  3. Place them in: apps/api/data/india/                      ║
║                                                              ║
║  4. Run: npm run ingest:india                                ║
║                                                              ║
║  The script will auto-scan and ingest ALL .csv files         ║
║  in the directory.                                           ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
    process.exit(0);
  }

  console.log(`Found ${csvFiles.length} CSV file(s) to ingest`);
  const ds = new DataSource(dataSourceOptions);
  await ds.initialize();

  // Ensure table exists
  await ds.query(`
    CREATE TABLE IF NOT EXISTS india_companies (
      cin VARCHAR(21) PRIMARY KEY,
      company_name VARCHAR(500) NOT NULL,
      status VARCHAR(50),
      company_type VARCHAR(100),
      company_class VARCHAR(50),
      category VARCHAR(100),
      sub_category VARCHAR(100),
      date_of_registration DATE,
      authorized_capital BIGINT,
      paid_up_capital BIGINT,
      state VARCHAR(100),
      roc VARCHAR(100),
      activity_code VARCHAR(10),
      activity_description VARCHAR(500),
      registered_address TEXT,
      email VARCHAR(255),
      listed_status VARCHAR(20),
      last_agm_date DATE,
      balance_sheet_date DATE
    )
  `);

  let totalInserted = 0;
  let totalSkipped = 0;

  for (let fileIdx = 0; fileIdx < csvFiles.length; fileIdx++) {
    const csvPath = csvFiles[fileIdx];
    const fileName = path.basename(csvPath);
    console.log(`\n[${fileIdx + 1}/${csvFiles.length}] Processing: ${fileName}`);

    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n');
    console.log(`  ${lines.length} lines`);

    let inserted = 0;
    let skipped = 0;

    // Detect header row and field positions
    const header = lines[0]?.toLowerCase() || '';
    const hasHeader = header.includes('cin') || header.includes('company') || header.includes('name');
    const startLine = hasHeader ? 1 : 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);
      if (fields.length < 2) { skipped++; continue; }

      // Try to identify CIN (21 chars, starts with letter) and company name
      let cin = '';
      let companyName = '';
      let status = '';
      let dateOfReg = '';
      let state = '';
      let registeredAddress = '';
      let email = '';

      // MCA monthly CSV format varies — try to detect
      for (let j = 0; j < Math.min(fields.length, 5); j++) {
        const val = fields[j]?.trim();
        if (!val) continue;
        // CIN is 21 chars: L/U + 5 digits + 2 letters + 4 digits + 3 letters + 6 digits + check
        if (/^[A-Z]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/i.test(val)) {
          cin = val.toUpperCase();
        } else if (!companyName && val.length > 3 && val.length < 300 && !/^\d+$/.test(val)) {
          companyName = val;
        }
      }

      if (!cin && !companyName) { skipped++; continue; }

      // Try to extract other fields based on position
      if (fields.length >= 3) status = fields[2]?.trim() || '';
      if (fields.length >= 8) dateOfReg = fields[7]?.trim() || '';
      if (fields.length >= 11) state = fields[10]?.trim() || '';
      if (fields.length >= 15) registeredAddress = fields[14]?.trim() || '';
      if (fields.length >= 16) email = fields[15]?.trim() || '';

      // Use CIN as primary key, or generate one from name
      const key = cin || `TEMP-${companyName.replace(/[^A-Z0-9]/gi, '').slice(0, 15)}`;

      try {
        await ds.query(
          `INSERT INTO india_companies (cin, company_name, status, date_of_registration, state, registered_address, email)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (cin) DO UPDATE SET company_name=EXCLUDED.company_name, status=COALESCE(EXCLUDED.status, india_companies.status)`,
          [key, companyName || cin, status || null, parseDate(dateOfReg), state || null, registeredAddress || null, email || null],
        );
        inserted++;
      } catch {
        skipped++;
      }

      if (inserted % 5000 === 0 && inserted > 0) {
        console.log(`  ${inserted.toLocaleString()} inserted...`);
      }
    }

    totalInserted += inserted;
    totalSkipped += skipped;
    console.log(`  Done: ${inserted.toLocaleString()} inserted, ${skipped} skipped`);
  }

  // Create indexes
  console.log('\nCreating indexes...');
  await ds.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_name ON india_companies USING gin(to_tsvector('simple', company_name))`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_state ON india_companies (state)`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_status ON india_companies (status)`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_name_trgm ON india_companies USING gin(company_name gin_trgm_ops)`).catch(() => {});

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`TOTAL: ${totalInserted.toLocaleString()} companies from ${csvFiles.length} file(s)`);
  console.log(`Skipped: ${totalSkipped.toLocaleString()}`);
  console.log(`${'═'.repeat(50)}`);

  await ds.destroy();
}

function parseDate(val: string): string | null {
  if (!val) return null;
  const dmy = val.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  return null;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') { inQuotes = !inQuotes; continue; }
    if (char === ',' && !inQuotes) { fields.push(current); current = ''; continue; }
    current += char;
  }
  fields.push(current);
  return fields;
}

main().catch((e) => { console.error(e); process.exit(1); });
