import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Central API Rate Limiter — coordinates rate limits across all services.
 *
 * Uses Redis sliding window counters so parallel investigations
 * don't exceed API rate limits and get IP-banned.
 *
 * Each API source has its own rate limit config:
 * - SEC EDGAR: 10 req/sec
 * - Wikidata SPARQL: 1 req/sec
 * - NSE India: 3 req/sec
 * - GDELT: 1 req/3sec
 * - FEC: 1 req/sec
 * - Nominatim: 1 req/sec
 * - CourtListener: 5 req/sec
 */

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'sec-edgar':     { maxRequests: 8,  windowMs: 1000 },
  'wikidata':      { maxRequests: 1,  windowMs: 2000 },
  'nse-india':     { maxRequests: 2,  windowMs: 1000 },
  'gdelt':         { maxRequests: 1,  windowMs: 3000 },
  'fec':           { maxRequests: 1,  windowMs: 1000 },
  'nominatim':     { maxRequests: 1,  windowMs: 1100 },
  'courtlistener': { maxRequests: 4,  windowMs: 1000 },
  'duckduckgo':    { maxRequests: 1,  windowMs: 2000 },
  'tofler':        { maxRequests: 1,  windowMs: 1500 },
  'default':       { maxRequests: 5,  windowMs: 1000 },
};

@Injectable()
export class ApiRateLimiterService {
  private readonly logger = new Logger(ApiRateLimiterService.name);
  // In-memory fallback timestamps per source
  private readonly lastRequest = new Map<string, number>();

  constructor(private readonly redis: RedisService) {}

  /**
   * Wait until it's safe to make a request to the given API source.
   * Uses Redis for cross-process coordination, falls back to in-memory.
   */
  async acquire(source: string): Promise<void> {
    const config = RATE_LIMITS[source] || RATE_LIMITS.default;
    const key = `ratelimit:${source}`;

    // Try Redis-based rate limiting
    try {
      const now = Date.now();
      const windowKey = `${key}:${Math.floor(now / config.windowMs)}`;
      const count = await this.redis.incr(windowKey);
      if (count === 1) {
        await this.redis.expire(windowKey, Math.ceil(config.windowMs / 1000) + 1);
      }
      if (count > config.maxRequests) {
        // Wait for the window to expire
        const waitMs = config.windowMs - (now % config.windowMs);
        await new Promise((r) => setTimeout(r, waitMs));
      }
      return;
    } catch {
      // Redis not available — fall back to in-memory
    }

    // In-memory fallback: simple delay between requests
    const minInterval = config.windowMs / config.maxRequests;
    const last = this.lastRequest.get(source) || 0;
    const wait = Math.max(0, minInterval - (Date.now() - last));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequest.set(source, Date.now());
  }

  /**
   * Execute a function with rate limiting for the given source.
   */
  async withLimit<T>(source: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(source);
    return fn();
  }
}
