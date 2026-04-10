import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKey } from './entities/api-key.entity';
import { ApiKeyGuard } from './api-key.guard';
import { V1Controller } from './v1.controller';
import { InvestigationModule } from '../investigation/investigation.module';
import { EntityResolutionModule } from '../entity-resolution/entity-resolution.module';
import { RedisService } from '../../common/redis/redis.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ApiKey]),
    InvestigationModule,
    EntityResolutionModule,
  ],
  providers: [ApiKeyGuard, RedisService],
  controllers: [V1Controller],
  exports: [ApiKeyGuard],
})
export class ApiKeysModule {}
