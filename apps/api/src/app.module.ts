import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
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
import { ApiKeysModule } from './modules/api-keys/api-keys.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    TypeOrmModule.forRoot(dataSourceOptions),
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
    InvestigationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
