import { Module } from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { NewsModule } from '../news/news.module';

@Module({
  imports: [NewsModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
