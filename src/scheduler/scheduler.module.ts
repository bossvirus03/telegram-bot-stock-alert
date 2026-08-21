import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { NewsModule } from '../news/news.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [NewsModule, TelegramModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
