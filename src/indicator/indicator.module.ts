import { Module, forwardRef } from '@nestjs/common';
import { IndicatorService } from './indicator.service';
import { PrismaModule } from '../prisma/prisma.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [
    PrismaModule,
    forwardRef(() => TelegramModule),
  ],
  providers: [IndicatorService],
  exports: [IndicatorService],
})
export class IndicatorModule {}
