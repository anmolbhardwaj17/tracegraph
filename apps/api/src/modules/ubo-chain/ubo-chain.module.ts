import { Module } from '@nestjs/common';
import { UboChainService } from './ubo-chain.service';
import { CompaniesHouseModule } from '../companies-house/companies-house.module';

@Module({
  imports: [CompaniesHouseModule],
  providers: [UboChainService],
  exports: [UboChainService],
})
export class UboChainModule {}
