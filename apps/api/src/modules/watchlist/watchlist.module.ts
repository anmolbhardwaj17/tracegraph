import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { WatchlistAlert } from './entities/watchlist-alert.entity';
import { WatchlistService } from './watchlist.service';
import { WatchlistMonitorService } from './watchlist-monitor.service';
import { WatchlistController } from './watchlist.controller';
import { InvestigationModule } from '../investigation/investigation.module';
import { Investigation } from '../investigation/entities/investigation.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, WatchlistAlert, Investigation]),
    forwardRef(() => InvestigationModule),
  ],
  providers: [WatchlistService, WatchlistMonitorService],
  controllers: [WatchlistController],
  exports: [WatchlistService, WatchlistMonitorService],
})
export class WatchlistModule {}
