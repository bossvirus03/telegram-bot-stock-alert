import { Module } from '@nestjs/common';
import { NewsService } from './news.service';

@Module({
  providers: [NewsService],
  exports: [NewsService],
})
export class NewsModule {}
