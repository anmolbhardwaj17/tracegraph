import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LogoCache } from './entities/logo-cache.entity';
import { LogosService } from './logos.service';
import { LogosController } from './logos.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LogoCache])],
  providers: [LogosService],
  controllers: [LogosController],
  exports: [LogosService],
})
export class LogosModule {}
