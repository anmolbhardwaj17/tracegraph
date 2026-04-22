import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { dataSourceOptions } from './data-source';
import { CompaniesHouseModule } from './modules/companies-house/companies-house.module';
import { InvestigationModule } from './modules/investigation/investigation.module';
import { GraphModule } from './modules/graph/graph.module';
import { OpenSanctionsModule } from './modules/open-sanctions/open-sanctions.module';
import { OffshoreLeaksModule } from './modules/offshore-leaks/offshore-leaks.module';
import { EntityResolutionModule } from './modules/entity-resolution/entity-resolution.module';
import { AnomalyModule } from './modules/anomaly/anomaly.module';
import { ReportModule } from './modules/report/report.module';
import { InsightsModule } from './modules/insights/insights.module';
import { GeocodingModule } from './modules/geocoding/geocoding.module';
import { DatasetsModule } from './modules/datasets/datasets.module';
import { LogosModule } from './modules/logos/logos.module';
import { WatchlistModule } from './modules/watchlist/watchlist.module';
import { JurisdictionsModule } from './modules/jurisdictions/jurisdictions.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { BatchModule } from './modules/batch/batch.module';
import { IndiaModule } from './modules/india/india.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { AuthModule } from './modules/auth/auth.module';
import { RedisModule } from './common/redis/redis.module';
import { EnrichmentCacheService } from './common/cache/enrichment-cache.service';
import { ApiRateLimiterService } from './common/rate-limiter/api-rate-limiter.service';
import { CircuitBreakerService } from './common/resilience/circuit-breaker.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    TypeOrmModule.forRoot(dataSourceOptions),
    RedisModule,
    CompaniesHouseModule,
    GraphModule,
    OpenSanctionsModule,
    OffshoreLeaksModule,
    EntityResolutionModule,
    AnomalyModule,
    ReportModule,
    InsightsModule,
    GeocodingModule,
    DatasetsModule,
    LogosModule,
    WatchlistModule,
    ApiKeysModule,
    JurisdictionsModule,
    InvestigationModule,
    BatchModule,
    IndiaModule,
    IntelligenceModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    EnrichmentCacheService,
    ApiRateLimiterService,
    CircuitBreakerService,
  ],
  exports: [EnrichmentCacheService, ApiRateLimiterService, CircuitBreakerService],
})
export class AppModule {}
