import { Module } from '@nestjs/common';
import { NewsFetcherService } from './news-fetcher.service';
import { NewsService } from './news.service';

@Module({
  providers: [NewsFetcherService, NewsService],
  exports: [NewsFetcherService, NewsService],
})
export class NewsModule {}
