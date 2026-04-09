import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { LogoCache } from './entities/logo-cache.entity';

export interface LogoResult {
  url: string | null;
  source: string | null;
}

@Injectable()
export class LogosService {
  private readonly logger = new Logger(LogosService.name);
  private readonly memCache = new Map<string, LogoResult>();

  constructor(
    @InjectRepository(LogoCache) private readonly cache: Repository<LogoCache>,
  ) {}

  private key(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /** Best-effort domain guess from a company name. */
  private candidateDomains(name: string): string[] {
    const cleaned = name
      .toLowerCase()
      .replace(/[\(\)\[\].,&'"`]/g, '')
      .replace(/\b(plc|ltd|limited|llp|holdings|group|company|co|inc|corp|corporation|the)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const noSpaces = cleaned.replace(/\s+/g, '');
    const noDashes = noSpaces.replace(/-/g, '');
    const firstWord = cleaned.split(' ')[0]?.replace(/-/g, '') || noSpaces;
    return Array.from(
      new Set([
        `${noSpaces}.com`,
        `${noDashes}.com`,
        `${noSpaces}.co.uk`,
        `${firstWord}.com`,
      ]),
    ).filter((d) => d.length > 5);
  }

  async lookup(name: string): Promise<LogoResult> {
    const key = this.key(name);
    if (!key) return { url: null, source: null };

    // 1. Memory
    if (this.memCache.has(key)) return this.memCache.get(key)!;

    // 2. DB
    try {
      const row = await this.cache.findOne({ where: { nameKey: key } });
      if (row) {
        const result: LogoResult = row.notFound ? { url: null, source: null } : { url: row.url, source: row.source };
        this.memCache.set(key, result);
        return result;
      }
    } catch (e: any) {
      this.logger.warn(`logo_cache lookup failed: ${e?.message}`);
    }

    // 3. Live discovery — try DuckDuckGo first, then Google favicon
    const domains = this.candidateDomains(name);
    let working: { url: string; source: string } | null = null;

    for (const domain of domains) {
      const ddg = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      if (await this.urlReturnsImage(ddg)) {
        working = { url: ddg, source: 'duckduckgo' };
        break;
      }
    }

    if (!working) {
      for (const domain of domains) {
        const google = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
        if (await this.urlReturnsImage(google)) {
          working = { url: google, source: 'google' };
          break;
        }
      }
    }

    // 4. Persist + memo
    const result: LogoResult = working ? { url: working.url, source: working.source } : { url: null, source: null };
    try {
      await this.cache.upsert(
        {
          nameKey: key,
          url: working?.url ?? (null as any),
          source: working?.source ?? (null as any),
          notFound: !working,
        },
        ['nameKey'],
      );
    } catch (e: any) {
      this.logger.warn(`logo_cache persist failed: ${e?.message}`);
    }
    this.memCache.set(key, result);
    return result;
  }

  /** HEAD a URL and check it returns an image with non-trivial body. */
  private async urlReturnsImage(url: string): Promise<boolean> {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 5000,
        validateStatus: () => true,
        maxContentLength: 200_000,
      });
      if (res.status !== 200) return false;
      const ct = (res.headers['content-type'] || '').toLowerCase();
      if (!ct.includes('image')) return false;
      // Reject placeholder favicons (DDG returns a tiny default image when domain is unknown)
      if (res.data && res.data.byteLength < 200) return false;
      return true;
    } catch {
      return false;
    }
  }
}
