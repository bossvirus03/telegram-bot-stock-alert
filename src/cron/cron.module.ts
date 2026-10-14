import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { WatchlistModule } from '../watchlist/watchlist.module';
import { TelegramModule } from '../telegram/telegram.module';
import { MacroModule } from '../macro/macro.module';
import { GoldModule } from '../gold/gold.module';
import { AlertModule } from '../alert/alert.module';
import { IndicatorModule } from '../indicator/indicator.module';

@Module({
  imports: [
    WatchlistModule,
    TelegramModule,
    MacroModule,
    GoldModule,
    AlertModule,
    IndicatorModule,
  ],
  providers: [CronService],
})
export class CronModule {}

