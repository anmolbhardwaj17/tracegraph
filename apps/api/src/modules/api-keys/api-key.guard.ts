import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from './entities/api-key.entity';
import { RedisService } from '../../common/redis/redis.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @InjectRepository(ApiKey) private readonly keys: Repository<ApiKey>,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const raw = req.headers['x-api-key'] as string;
    if (!raw) throw new UnauthorizedException('Missing X-API-Key header');

    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const key = await this.keys.findOne({ where: { keyHash: hash } });
    if (!key) throw new UnauthorizedException('Invalid API key');

    // Per-key rate limiting via Redis sliding window
    const windowKey = `apilimit:${key.id}`;
    const count = await this.redis.incr(windowKey);
    if (count === 1) await this.redis.expire(windowKey, 3600); // 1 hour window
    if (count > key.rateLimit) {
      throw new UnauthorizedException(`Rate limit exceeded (${key.rateLimit} req/hour)`);
    }

    req.apiKey = key;
    return true;
  }
}
