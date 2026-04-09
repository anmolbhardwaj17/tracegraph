import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { RedisService } from '../../common/redis/redis.service';
import { TokenBucketRateLimiter } from '../../common/rate-limiter/token-bucket.service';

const BASE_URL = 'https://api.company-information.service.gov.uk';
const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const RATE_LIMIT_BUCKET = 'companies-house';
const RATE_LIMIT_CAPACITY = 600;
const RATE_LIMIT_WINDOW = 300; // 5 minutes
const MAX_RETRIES = 4;

export interface CompaniesHouseClient {
  http: AxiosInstance;
}

@Injectable()
export class CompaniesHouseService {
  private readonly logger = new Logger(CompaniesHouseService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly redis: RedisService,
    private readonly limiter: TokenBucketRateLimiter,
  ) {
    const apiKey = process.env.COMPANIES_HOUSE_API_KEY || '';
    this.http = axios.create({
      baseURL: BASE_URL,
      auth: { username: apiKey, password: '' },
      timeout: 15000,
    });
  }

  // For tests
  setHttpClient(client: AxiosInstance) {
    (this as any).http = client;
  }

  async getCompany(companyNumber: string): Promise<any> {
    return this.request(`/company/${encodeURIComponent(companyNumber)}`);
  }

  async getOfficers(companyNumber: string): Promise<any> {
    return this.request(`/company/${encodeURIComponent(companyNumber)}/officers`);
  }

  async getPSC(companyNumber: string): Promise<any> {
    return this.request(
      `/company/${encodeURIComponent(companyNumber)}/persons-with-significant-control`,
    );
  }

  async getFilingHistory(companyNumber: string): Promise<any> {
    return this.request(`/company/${encodeURIComponent(companyNumber)}/filing-history`);
  }

  async searchCompanies(query: string): Promise<any> {
    return this.request(`/search/companies?q=${encodeURIComponent(query)}`);
  }

  async getOfficerAppointments(officerId: string): Promise<any> {
    return this.request(`/officers/${encodeURIComponent(officerId)}/appointments`);
  }

  async searchDisqualifiedOfficers(query: string): Promise<any> {
    return this.request(`/disqualified-officers/search?q=${encodeURIComponent(query)}`);
  }

  async getDisqualifiedOfficer(officerId: string): Promise<any> {
    return this.request(`/disqualified-officers/natural/${encodeURIComponent(officerId)}`);
  }

  private async request(path: string): Promise<any> {
    const cacheKey = `ch:${path}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try { return JSON.parse(cached); } catch { /* fall through */ }
    }

    await this.limiter.acquire(RATE_LIMIT_BUCKET, RATE_LIMIT_CAPACITY, RATE_LIMIT_WINDOW);

    let attempt = 0;
    let lastError: any;
    while (attempt <= MAX_RETRIES) {
      try {
        const res = await this.http.get(path);
        await this.redis.setex(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(res.data));
        return res.data;
      } catch (err) {
        lastError = err;
        const status = (err as AxiosError).response?.status;
        if (status === 404) throw err;
        if (status && ![429, 500, 502, 503, 504].includes(status)) throw err;
        attempt++;
        if (attempt > MAX_RETRIES) break;
        const backoff = Math.min(30000, 500 * Math.pow(2, attempt));
        this.logger.warn(`CH ${path} failed (status=${status}), retry ${attempt} in ${backoff}ms`);
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
    throw lastError;
  }
}
