/**
 * MCA Company Master Data Ingestion Script.
 *
 * Usage:
 *   1. Download company master CSVs from MCA website:
 *      https://www.mca.gov.in/content/mca/global/en/data-and-reports/company-llp-master-data.html
 *      (requires manual CAPTCHA — download state-by-state or all-India CSV)
 *
 *   2. Place CSV file(s) in apps/api/data/india/
 *
 *   3. Run: npm run ingest:india
 *      Or:  npx ts-node src/seeds/ingest-india-companies.ts [path-to-csv]
 *
 * CSV Expected Format (MCA Company Master):
 *   CIN, Company Name, Status, Company Type, Class, Category, Sub Category,
 *   Date of Registration, Authorized Capital, Paid Up Capital, State, ROC,
 *   Activity Code, Activity Description, Registered Address, Email,
 *   Listed Status, Last AGM Date, Balance Sheet Date
 */

import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source';

async function main() {
  const csvPath = process.argv[2] || path.resolve(__dirname, '../../data/india/company-master.csv');

  if (!fs.existsSync(csvPath)) {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║  MCA Company Master Data Ingestion                          ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  No CSV file found at: ${csvPath.slice(-40).padEnd(36)}  ║
║                                                              ║
║  To ingest Indian company data:                              ║
║                                                              ║
║  1. Go to MCA website:                                       ║
║     mca.gov.in > Data & Reports > Company/LLP Master Data    ║
║                                                              ║
║  2. Download the CSV (requires CAPTCHA)                      ║
║                                                              ║
║  3. Place it at: apps/api/data/india/company-master.csv      ║
║                                                              ║
║  4. Run: npx ts-node src/seeds/ingest-india-companies.ts     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
    process.exit(0);
  }

  console.log(`Loading MCA Company Master from: ${csvPath}`);
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

  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  console.log(`Found ${lines.length} lines`);

  let inserted = 0;
  let skipped = 0;
  const batchSize = 500;
  let batch: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV (handle quoted fields)
    const fields = parseCSVLine(line);
    if (fields.length < 5 || !fields[0]) { skipped++; continue; }

    batch.push(fields);

    if (batch.length >= batchSize) {
      await insertBatch(ds, batch);
      inserted += batch.length;
      batch = [];
      if (inserted % 10000 === 0) {
        console.log(`  Processed ${inserted.toLocaleString()} companies...`);
      }
    }
  }

  if (batch.length > 0) {
    await insertBatch(ds, batch);
    inserted += batch.length;
  }

  // Create indexes
  console.log('Creating indexes...');
  await ds.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_name ON india_companies USING gin(to_tsvector('simple', company_name))`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_state ON india_companies (state)`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_status ON india_companies (status)`).catch(() => {});
  await ds.query(`CREATE INDEX IF NOT EXISTS idx_india_co_name_trgm ON india_companies USING gin(company_name gin_trgm_ops)`).catch(() => {});

  console.log(`\nDone: ${inserted.toLocaleString()} companies inserted, ${skipped} skipped`);
  await ds.destroy();
}

async function insertBatch(ds: DataSource, batch: string[][]): Promise<void> {
  const values: string[] = [];
  const params: any[] = [];
  let paramIdx = 1;

  for (const fields of batch) {
    const cin = fields[0]?.trim();
    if (!cin || cin.length < 5) continue;

    const placeholders = [];
    for (let j = 0; j < 19; j++) {
      const val = fields[j]?.trim() || null;
      // Handle date fields (7, 17, 18)
      if ((j === 7 || j === 17 || j === 18) && val) {
        const parsed = parseDate(val);
        params.push(parsed);
      } else if ((j === 8 || j === 9) && val) {
        // Capital fields — parse as number
        params.push(parseInt(val.replace(/[^0-9]/g, ''), 10) || null);
      } else {
        params.push(val);
      }
      placeholders.push(`$${paramIdx++}`);
    }
    values.push(`(${placeholders.join(',')})`);
  }

  if (values.length === 0) return;

  await ds.query(
    `INSERT INTO india_companies (cin, company_name, status, company_type, company_class, category, sub_category, date_of_registration, authorized_capital, paid_up_capital, state, roc, activity_code, activity_description, registered_address, email, listed_status, last_agm_date, balance_sheet_date) VALUES ${values.join(',')} ON CONFLICT (cin) DO UPDATE SET company_name=EXCLUDED.company_name, status=EXCLUDED.status, paid_up_capital=EXCLUDED.paid_up_capital`,
    params,
  );
}

function parseDate(val: string): string | null {
  if (!val) return null;
  // Try DD-MM-YYYY or DD/MM/YYYY
  const dmy = val.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  // Try YYYY-MM-DD
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
