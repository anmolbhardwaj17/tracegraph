import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entities/company.entity';
import { Officer } from './entities/officer.entity';
import { CompanyOfficer } from './entities/company-officer.entity';
import { Address } from './entities/address.entity';
import { PSC } from './entities/psc.entity';
import { CompaniesHouseService } from './companies-house.service';
import { CompaniesHouseController } from './companies-house.controller';
import { RedisService } from '../../common/redis/redis.service';
import { TokenBucketRateLimiter } from '../../common/rate-limiter/token-bucket.service';

@Module({
  imports: [TypeOrmModule.forFeature([Company, Officer, CompanyOfficer, Address, PSC])],
  providers: [CompaniesHouseService, RedisService, TokenBucketRateLimiter],
  controllers: [CompaniesHouseController],
  exports: [CompaniesHouseService, TypeOrmModule],
})
export class CompaniesHouseModule {}
