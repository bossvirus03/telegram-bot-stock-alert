import { Module, forwardRef } from '@nestjs/common';
import { AlertService } from './alert.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GoldModule } from '../gold/gold.module';
import { StockModule } from '../stock/stock.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    GoldModule,
    StockModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
