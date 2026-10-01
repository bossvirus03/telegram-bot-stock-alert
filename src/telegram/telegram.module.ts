import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { StockModule } from '../stock/stock.module';
import { NewsModule } from '../news/news.module';
import { AiModule } from '../ai/ai.module';
import { MacroModule } from '../macro/macro.module';
import { GoldModule } from '../gold/gold.module';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [
    WatchlistModule,
    StockModule,
    NewsModule,
    AiModule,
    MacroModule,
    GoldModule,
    forwardRef(() => AlertModule),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}

