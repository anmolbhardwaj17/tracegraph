import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  public readonly client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
    this.client.connect().catch(() => {
      // best-effort; cache becomes a no-op via try/catch in callers
    });
  }

  async get(key: string): Promise<string | null> {
    try { return await this.client.get(key); } catch { return null; }
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    try { await this.client.setex(key, ttlSeconds, value); } catch { /* ignore */ }
  }

  async incr(key: string): Promise<number> {
    try { return await this.client.incr(key); } catch { return 0; }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try { await this.client.expire(key, seconds); } catch { /* ignore */ }
  }

  async onModuleDestroy() {
    try { await this.client.quit(); } catch { /* ignore */ }
  }
}
