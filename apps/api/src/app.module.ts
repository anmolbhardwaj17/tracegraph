import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOptions } from './data-source';
import { CompaniesHouseModule } from './modules/companies-house/companies-house.module';
import { InvestigationModule } from './modules/investigation/investigation.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(dataSourceOptions),
    CompaniesHouseModule,
    InvestigationModule,
  ],
})
export class AppModule {}
