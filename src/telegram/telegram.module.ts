import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { StockModule } from '../stock/stock.module';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [WatchlistModule, StockModule, NewsModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
