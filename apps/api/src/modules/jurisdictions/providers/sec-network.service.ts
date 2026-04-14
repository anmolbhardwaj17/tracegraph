import { Logger } from '@nestjs/common';
import axios from 'axios';

const DATA_BASE = 'https://data.sec.gov';
const SEC_BASE = 'https://www.sec.gov';
const USER_AGENT = 'TraceGraph contact@tracegraph.com';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

const cache = new Map<string, { data: any; expiresAt: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000;

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T);
  return fn().then((data) => { cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL }); return data; });
}

let lastReq = 0;
async function rl<T>(fn: () => Promise<T>): Promise<T> {
  const wait = Math.max(0, 120 - (Date.now() - lastReq));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastReq = Date.now();
  return fn();
}

function padCik(cik: string | number): string { return String(cik).replace(/^0+/, '').padStart(10, '0'); }

export interface SecOfficer {
  name: string;
  cik: string;
  title: string;
  isDirector: boolean;
  isOfficer: boolean;
  otherCompanies: Array<{ name: string; cik: string; ticker: string; title: string }>;
}

export interface SecCompanyProfile {
  name: string;
  cik: string;
  ticker: string | null;
  exchange: string | null;
  sic: string | null;
  sicDescription: string | null;
  stateOfInc: string | null;
  category: string | null;
  entityType: string | null;
  address: string | null;
  filingCount: number;
}

const logger = new Logger('SecNetworkService');

/** Get rich company profile from SEC submissions */
export async function getSecProfile(cik: string): Promise<SecCompanyProfile | null> {
  return cached(`secnet:profile:${cik}`, async () => {
    try {
      const res = await rl(() => axios.get(`${DATA_BASE}/submissions/CIK${padCik(cik)}.json`, { headers: HEADERS, timeout: 10000 }));
      const d = res.data;
      const addr = d.addresses?.business || d.addresses?.mailing || {};
      return {
        name: d.name, cik,
        ticker: d.tickers?.[0] || null,
        exchange: d.exchanges?.[0] || null,
        sic: d.sic || null,
        sicDescription: d.sicDescription || null,
        stateOfInc: d.stateOfIncorporation || null,
        category: d.category || null,
        entityType: d.entityType || null,
        address: [addr.street1, addr.street2, addr.city, addr.stateOrCountry, addr.zipCode].filter(Boolean).join(', ') || null,
        filingCount: d.filings?.recent?.form?.length || 0,
      };
    } catch (e: any) {
      logger.warn(`SEC profile failed for ${cik}: ${e?.message}`);
      return null;
    }
  });
}

/** Get all Form 4 filer CIKs for a company */
export async function getForm4Filers(companyCik: string): Promise<string[]> {
  return cached(`secnet:filers:${companyCik}`, async () => {
    try {
      const res = await rl(() => axios.get(`${DATA_BASE}/submissions/CIK${padCik(companyCik)}.json`, { headers: HEADERS, timeout: 10000 }));
      const filings = res.data?.filings?.recent || {};
      const forms = filings.form || [];
      const accessions = filings.accessionNumber || [];
      const seen = new Set<string>();
      const filers: string[] = [];
      for (let i = 0; i < forms.length; i++) {
        if (forms[i] !== '4') continue;
        const filerCik = accessions[i]?.split('-')[0]?.replace(/^0+/, '');
        if (!filerCik || filerCik === companyCik.replace(/^0+/, '') || seen.has(filerCik)) continue;
        seen.add(filerCik);
        filers.push(filerCik);
        if (filers.length >= 30) break;
      }
      return filers;
    } catch { return []; }
  });
}

/** Get officer details + their other companies from Form 4 XMLs */
export async function getOfficerDetails(personCik: string, companyCik: string): Promise<SecOfficer | null> {
  return cached(`secnet:officer:${personCik}:${companyCik}`, async () => {
    try {
      // Get person's submissions
      const res = await rl(() => axios.get(`${DATA_BASE}/submissions/CIK${padCik(personCik)}.json`, { headers: HEADERS, timeout: 10000 }));
      const d = res.data;
      const name = d.name || 'Unknown';
      const filings = d.filings?.recent || {};
      const forms = filings.form || [];
      const accessions = filings.accessionNumber || [];

      // Find a Form 4 filed for the target company to get title/role
      let title = 'Officer/Director';
      let isDirector = false;
      let isOfficer = true;

      // Parse ONE Form 4 XML for the target company to get exact role
      for (let i = 0; i < Math.min(forms.length, 50); i++) {
        if (forms[i] !== '4') continue;
        try {
          const acc = accessions[i];
          const accClean = acc.replace(/-/g, '');
          // Get the raw XML
          const idxRes = await rl(() => axios.get(`${SEC_BASE}/Archives/edgar/data/${personCik}/${accClean}/${acc}-index.htm`, { headers: HEADERS, timeout: 5000, responseType: 'text' }));
          const xmlMatch = (idxRes.data as string).match(/href="([^"]+(?:form4|F345)[^"]*\.xml)"/i) || (idxRes.data as string).match(/href="([^"]+\.xml)"/);
          if (!xmlMatch) continue;
          let xmlUrl = xmlMatch[1];
          if (!xmlUrl.startsWith('http')) xmlUrl = `${SEC_BASE}${xmlUrl.startsWith('/') ? '' : '/'}${xmlUrl}`;
          const xmlRes = await rl(() => axios.get(xmlUrl, { headers: HEADERS, timeout: 5000, responseType: 'text' }));
          const xml = xmlRes.data as string;

          const issuerCik = xml.match(/<issuerCik>([^<]+)/)?.[1]?.replace(/^0+/, '');
          const officerTitle = xml.match(/<officerTitle>([^<]+)/)?.[1];
          const isDirVal = xml.match(/<isDirector>([^<]+)/)?.[1];
          const isOffVal = xml.match(/<isOfficer>([^<]+)/)?.[1];

          if (issuerCik === companyCik.replace(/^0+/, '')) {
            title = officerTitle || 'Officer';
            isDirector = isDirVal === '1';
            isOfficer = isOffVal === '1';
            break;
          }
        } catch { continue; }
      }

      // Find other companies this person is an insider at
      const otherCompanies: SecOfficer['otherCompanies'] = [];
      const seenIssuers = new Set<string>([companyCik.replace(/^0+/, '')]);

      // Parse Form 4s to find different issuers
      for (let i = 0; i < Math.min(forms.length, 100); i++) {
        if (forms[i] !== '4') continue;
        try {
          const acc = accessions[i];
          const accClean = acc.replace(/-/g, '');
          const idxRes = await rl(() => axios.get(`${SEC_BASE}/Archives/edgar/data/${personCik}/${accClean}/${acc}-index.htm`, { headers: HEADERS, timeout: 5000, responseType: 'text' }));
          const xmlMatch = (idxRes.data as string).match(/href="([^"]+\.xml)"/);
          if (!xmlMatch) continue;
          let xmlUrl = xmlMatch[1];
          if (!xmlUrl.startsWith('http')) xmlUrl = `${SEC_BASE}${xmlUrl.startsWith('/') ? '' : '/'}${xmlUrl}`;
          const xmlRes = await rl(() => axios.get(xmlUrl, { headers: HEADERS, timeout: 5000, responseType: 'text' }));
          const xml = xmlRes.data as string;

          const issuerCik = xml.match(/<issuerCik>([^<]+)/)?.[1]?.replace(/^0+/, '');
          const issuerName = xml.match(/<issuerName>([^<]+)/)?.[1];
          const issuerTicker = xml.match(/<issuerTradingSymbol>([^<]+)/)?.[1] || '';
          const offTitle = xml.match(/<officerTitle>([^<]+)/)?.[1] || '';

          if (issuerCik && !seenIssuers.has(issuerCik)) {
            seenIssuers.add(issuerCik);
            otherCompanies.push({ name: issuerName || issuerCik, cik: issuerCik, ticker: issuerTicker, title: offTitle });
          }
          if (otherCompanies.length >= 10) break;
        } catch { continue; }
      }

      return { name, cik: personCik, title, isDirector, isOfficer, otherCompanies };
    } catch (e: any) {
      logger.warn(`Officer details failed for ${personCik}: ${e?.message}`);
      return null;
    }
  });
}
