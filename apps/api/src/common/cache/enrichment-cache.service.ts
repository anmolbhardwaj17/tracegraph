import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Shared Enrichment Cache — Redis-backed with in-memory fallback.
 *
 * Used by all enrichment services instead of per-service Map() caches.
 * Persists across restarts, shared across workers.
 *
 * Key format: "enrich:{source}:{identifier}"
 * TTL: configurable per source (default 12h)
 */
@Injectable()
export class EnrichmentCacheService {
  private readonly logger = new Logger(EnrichmentCacheService.name);
  private readonly memFallback = new Map<string, { data: string; expiresAt: number }>();
  private redisAvailable = true;

  constructor(private readonly redis: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    // Try Redis first
    if (this.redisAvailable) {
      try {
        const val = await this.redis.get(`enrich:${key}`);
        if (val) return JSON.parse(val) as T;
      } catch {
        this.redisAvailable = false;
      }
    }

    // Fallback to in-memory
    const mem = this.memFallback.get(key);
    if (mem && mem.expiresAt > Date.now()) {
      return JSON.parse(mem.data) as T;
    }

    return null;
  }

  async set(key: string, data: any, ttlSeconds = 43200): Promise<void> {
    const json = JSON.stringify(data);

    // Try Redis
    if (this.redisAvailable) {
      try {
        await this.redis.setex(`enrich:${key}`, ttlSeconds, json);
        return;
      } catch {
        this.redisAvailable = false;
      }
    }

    // Fallback to in-memory
    this.memFallback.set(key, { data: json, expiresAt: Date.now() + ttlSeconds * 1000 });

    // Evict old entries if memory cache grows too large
    if (this.memFallback.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.memFallback) {
        if (v.expiresAt < now) this.memFallback.delete(k);
      }
    }
  }

  /**
   * Cache-through helper: get from cache or compute + store.
   * Skips caching empty arrays if skipEmpty=true (prevents caching failed API results).
   */
  async cached<T>(key: string, fn: () => Promise<T>, ttlSeconds = 43200, skipEmpty = false): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit != null) return hit;

    const result = await fn();

    // Don't cache empty arrays if skipEmpty (prevents caching rate-limit artifacts)
    if (skipEmpty && Array.isArray(result) && result.length === 0) return result;
    // Don't cache null/undefined
    if (result == null) return result;

    await this.set(key, result, ttlSeconds);
    return result;
  }
}
