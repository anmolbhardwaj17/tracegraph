import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { GeocodeCache } from './entities/geocode-cache.entity';

export interface GeocodeResult {
  lat: number;
  lng: number;
  displayName: string;
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly memCache = new Map<string, GeocodeResult | null>();

  constructor(
    @InjectRepository(GeocodeCache) private readonly cache: Repository<GeocodeCache>,
  ) {}

  private key(address: string): string {
    return address.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async geocode(address: string): Promise<GeocodeResult | null> {
    const key = this.key(address);
    if (!key) return null;

    // 1. Memory cache
    if (this.memCache.has(key)) return this.memCache.get(key)!;

    // 2. DB cache (shared across investigations)
    try {
      const row = await this.cache.findOne({ where: { addressKey: key } });
      if (row) {
        if (row.notFound || row.lat == null || row.lng == null) {
          this.memCache.set(key, null);
          return null;
        }
        const result = { lat: row.lat, lng: row.lng, displayName: row.displayName };
        this.memCache.set(key, result);
        return result;
      }
    } catch (e: any) {
      this.logger.warn(`geocode_cache lookup failed: ${e?.message}`);
    }

    // 3. Hit Nominatim
    try {
      const res = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: { q: address, format: 'json', limit: 1, addressdetails: 0 },
        headers: { 'User-Agent': 'TraceGraph/0.1 (open-source corporate intelligence)' },
        timeout: 10000,
      });
      const hit = res.data?.[0];
      if (!hit) {
        await this.persist(key, null);
        this.memCache.set(key, null);
        return null;
      }
      const result: GeocodeResult = {
        lat: parseFloat(hit.lat),
        lng: parseFloat(hit.lon),
        displayName: hit.display_name,
      };
      await this.persist(key, result);
      this.memCache.set(key, result);
      return result;
    } catch (e: any) {
      this.logger.warn(`Geocode failed for "${address}": ${e?.message}`);
      return null;
    }
  }

  private async persist(addressKey: string, result: GeocodeResult | null): Promise<void> {
    try {
      await this.cache.upsert(
        {
          addressKey,
          lat: result?.lat ?? (null as any),
          lng: result?.lng ?? (null as any),
          displayName: result?.displayName ?? (null as any),
          notFound: result === null,
        },
        ['addressKey'],
      );
    } catch (e: any) {
      this.logger.warn(`geocode_cache persist failed: ${e?.message}`);
    }
  }
}
