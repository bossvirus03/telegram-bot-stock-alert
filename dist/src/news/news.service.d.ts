import { PrismaService } from '../prisma/prisma.service';
import { NewsItem } from './news.interface';
import { News } from '@prisma/client';
export declare class NewsService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    saveAndFilterNewNews(items: NewsItem[]): Promise<NewsItem[]>;
    getLatestNews(limit?: number): Promise<News[]>;
    searchNewsByTicker(ticker: string, limit?: number): Promise<News[]>;
}
