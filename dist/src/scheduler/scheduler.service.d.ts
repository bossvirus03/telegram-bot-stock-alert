import { OnModuleInit } from '@nestjs/common';
import { NewsFetcherService } from '../news/news-fetcher.service';
import { NewsService } from '../news/news.service';
import { TelegramService } from '../telegram/telegram.service';
export declare class SchedulerService implements OnModuleInit {
    private readonly newsFetcherService;
    private readonly newsService;
    private readonly telegramService;
    private readonly logger;
    constructor(newsFetcherService: NewsFetcherService, newsService: NewsService, telegramService: TelegramService);
    onModuleInit(): Promise<void>;
    handleCron(): Promise<void>;
}
