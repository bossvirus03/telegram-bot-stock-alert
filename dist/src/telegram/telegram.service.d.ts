import { OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from '../news/news.service';
import { NewsItem } from '../news/news.interface';
export declare class TelegramService implements OnModuleInit, OnModuleDestroy {
    private readonly configService;
    private readonly prisma;
    private readonly newsService;
    private readonly logger;
    private bot?;
    constructor(configService: ConfigService, prisma: PrismaService, newsService: NewsService);
    onModuleInit(): Promise<void>;
    onModuleDestroy(): void;
    private registerCommands;
    broadcastNews(newsList: NewsItem[]): Promise<void>;
    private formatNewsMessage;
    private escapeHtml;
}
