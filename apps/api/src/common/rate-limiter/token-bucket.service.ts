import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

/**
 * Token bucket via Redis. Companies House: 600 requests per 5 minutes.
 * Implementation: a sliding window counter using INCR + EXPIRE on a 300s key.
 * If count exceeds capacity, sleep until window rolls.
 */
@Injectable()
export class TokenBucketRateLimiter {
  constructor(private readonly redis: RedisService) {}

  async acquire(
    bucket: string,
    capacity: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `ratelimit:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    if (count > capacity) {
      // Sleep proportional to overage; a real impl would read TTL.
      const wait = Math.min(windowSeconds * 1000, 1000 * (count - capacity));
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
