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

  private static readonly KNOWN: Record<string, string> = {
    'gymshark ltd': 'gymshark.com', 'tesco plc': 'tesco.com',
    'greensill capital (uk) limited': 'greensill.com', 'harrods limited': 'harrods.com',
    'burberry limited': 'burberry.com', 'jaguar land rover limited': 'jaguarlandrover.com',
    'aston martin lagonda limited': 'astonmartin.com', 'rolls-royce plc': 'rolls-royce.com',
    'british broadcasting corporation': 'bbc.co.uk', 'boohoo.com uk limited': 'boohoo.com',
    'dyson uk holdings limited': 'dyson.com', 'barclays plc': 'barclays.com',
    'hsbc holdings plc': 'hsbc.com', 'unilever plc': 'unilever.com',
    'bp plc': 'bp.com', 'shell plc': 'shell.com', 'vodafone group plc': 'vodafone.com',
    'arm limited': 'arm.com', 'revolut ltd': 'revolut.com', 'deliveroo plc': 'deliveroo.com',
    'monzo bank limited': 'monzo.com', 'sports direct international plc': 'sportsdirect.com',
    'next plc': 'next.co.uk', 'marks and spencer group plc': 'marksandspencer.com',
    'manchester united football club limited': 'manutd.com',
    'chelsea fc plc': 'chelseafc.com', 'arsenal holdings plc': 'arsenal.com',
    'tottenham hotspur limited': 'tottenhamhotspur.com',
    'liverpool football club and athletic grounds limited': 'liverpoolfc.com',
  };

  /** Best-effort domain guess from a company name. */
  private candidateDomains(name: string): string[] {
    // Check known domains first
    const known = LogosService.KNOWN[name.toLowerCase().trim()];
    if (known) return [known];

    const cleaned = name
      .toLowerCase()
      .replace(/[\(\)\[\].,&'"`]/g, '')
      .replace(/\b(plc|ltd|limited|llp|holdings|group|company|co|inc|corp|corporation|the|uk)\b/g, '')
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

    // Try Logo.dev if token available (higher quality)
    if (!working) {
      const logoDevToken = process.env.LOGO_DEV_TOKEN;
      if (logoDevToken) {
        for (const domain of domains) {
          const logoDevUrl = `https://img.logo.dev/${domain}?token=${logoDevToken}&size=128&format=png`;
          if (await this.urlReturnsImage(logoDevUrl)) {
            working = { url: logoDevUrl, source: 'logodev' };
            break;
          }
        }
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

    // 4. Try OpenRouter AI as last resort
    if (!working) {
      const aiUrl = await this.findLogoViaAI(name);
      if (aiUrl) working = { url: aiUrl, source: 'openrouter' };
    }

    // 5. Persist + memo
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

  /** Ask OpenRouter to find a company's logo URL. */
  private async findLogoViaAI(companyName: string): Promise<string | null> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return null;

    try {
      const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.0-flash-001';
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model,
          messages: [{
            role: 'user',
            content: `What is the official website domain for the company "${companyName}"? Reply with ONLY the domain name (e.g. "example.com"), nothing else. If you don't know, reply "unknown".`,
          }],
          temperature: 0,
          max_tokens: 50,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        },
      );

      const text = (res.data?.choices?.[0]?.message?.content || '').trim().toLowerCase();
      if (!text || text === 'unknown' || text.includes(' ') || !text.includes('.')) return null;

      // Clean up: remove quotes, trailing periods, http prefix
      const domain = text.replace(/['"]/g, '').replace(/\.$/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      if (!domain || domain.length < 4) return null;

      // Try favicon for this domain
      const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;
      if (await this.urlReturnsImage(faviconUrl)) {
        this.logger.log(`AI resolved ${companyName} -> ${domain}`);
        return faviconUrl;
      }

      // Also try DuckDuckGo
      const ddgUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;
      if (await this.urlReturnsImage(ddgUrl)) {
        this.logger.log(`AI resolved ${companyName} -> ${domain} (DDG)`);
        return ddgUrl;
      }

      return null;
    } catch (e: any) {
      this.logger.warn(`AI logo lookup failed for ${companyName}: ${e?.message}`);
      return null;
    }
  }

  /** HEAD a URL and check it returns an image with non-trivial body. */
  private async urlReturnsImage(url: string): Promise<boolean> {
    try {
      const res = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 2500,
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
