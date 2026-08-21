import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NewsFetcherService } from '../news/news-fetcher.service';
import { NewsService } from '../news/news.service';
import { TelegramService } from '../telegram/telegram.service';

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly newsFetcherService: NewsFetcherService,
    private readonly newsService: NewsService,
    private readonly telegramService: TelegramService,
  ) {}

  async onModuleInit() {
    this.logger.log('SchedulerService đã sẵn sàng. Thực hiện quét tin CafeF & Investing.com ban đầu...');
    await this.handleCron();
  }

  /**
   * Cronjob tự động chạy quét tin tức chứng khoán mới từ CafeF và Investing.com định kỳ
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async handleCron() {
    this.logger.log('⏰ [CronJob] Bắt đầu quét tin tức chứng khoán mới từ CafeF & Investing.com...');

    const fetchedItems = await this.newsFetcherService.fetchAllNews();
    if (!fetchedItems || fetchedItems.length === 0) {
      this.logger.warn('[CronJob] Không thu thập được tin tức mới nào.');
      return;
    }

    // Lưu vào Database PostgreSQL & Lọc tin mới chưa có trong DB
    const newItems = await this.newsService.saveAndFilterNewNews(fetchedItems);

    if (newItems.length > 0) {
      this.logger.log(`🔥 Phát hiện ${newItems.length} tin tức MỚI từ CafeF & Investing.com! Tiến hành phát thông báo...`);
      await this.telegramService.broadcastNews(newItems);
    } else {
      this.logger.log('✅ Không có tin tức mới phát sinh.');
    }
  }
}
