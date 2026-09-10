import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { NewsModule } from '../news/news.module';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { StockModule } from '../stock/stock.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MacroModule } from '../macro/macro.module';

@Module({
  imports: [NewsModule, WatchlistModule, StockModule, TelegramModule, MacroModule],
  providers: [CronService],
})
export class CronModule {}
