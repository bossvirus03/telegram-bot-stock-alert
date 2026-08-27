import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { StockModule } from './stock/stock.module';
import { NewsModule } from './news/news.module';
import { WatchlistModule } from './watchlist/watchlist.module';
import { TelegramModule } from './telegram/telegram.module';
import { CronModule } from './cron/cron.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    StockModule,
    NewsModule,
    WatchlistModule,
    TelegramModule,
    CronModule,
  ],
})
export class AppModule {}
