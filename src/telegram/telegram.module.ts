import { Module, forwardRef } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { MacroModule } from '../macro/macro.module';
import { GoldModule } from '../gold/gold.module';
import { AlertModule } from '../alert/alert.module';

@Module({
  imports: [
    WatchlistModule,
    MacroModule,
    GoldModule,
    forwardRef(() => AlertModule),
  ],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
