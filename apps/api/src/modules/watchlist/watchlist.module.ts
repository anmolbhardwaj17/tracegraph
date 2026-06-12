import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { WatchlistAlert } from './entities/watchlist-alert.entity';
import { WatchlistService } from './watchlist.service';
import { WatchlistMonitorService } from './watchlist-monitor.service';
import { WatchlistSchedulerService } from './watchlist-scheduler.service';
import { WatchlistController } from './watchlist.controller';
import { InvestigationModule } from '../investigation/investigation.module';
import { Investigation } from '../investigation/entities/investigation.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WatchlistItem, WatchlistAlert, Investigation]),
    forwardRef(() => InvestigationModule),
    NotificationsModule,
  ],
  providers: [WatchlistService, WatchlistMonitorService, WatchlistSchedulerService],
  controllers: [WatchlistController],
  exports: [WatchlistService, WatchlistMonitorService, WatchlistSchedulerService],
})
export class WatchlistModule {}
