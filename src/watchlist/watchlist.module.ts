import { Module } from '@nestjs/common';
import { WatchlistService } from './watchlist.service';

@Module({
  providers: [WatchlistService],
  exports: [WatchlistService],
})
export class WatchlistModule {}
