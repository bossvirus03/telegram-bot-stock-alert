"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var SchedulerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const news_fetcher_service_1 = require("../news/news-fetcher.service");
const news_service_1 = require("../news/news.service");
const telegram_service_1 = require("../telegram/telegram.service");
let SchedulerService = SchedulerService_1 = class SchedulerService {
    newsFetcherService;
    newsService;
    telegramService;
    logger = new common_1.Logger(SchedulerService_1.name);
    constructor(newsFetcherService, newsService, telegramService) {
        this.newsFetcherService = newsFetcherService;
        this.newsService = newsService;
        this.telegramService = telegramService;
    }
    async onModuleInit() {
        this.logger.log('SchedulerService đã sẵn sàng. Thực hiện quét tin CafeF & Investing.com ban đầu...');
        await this.handleCron();
    }
    async handleCron() {
        this.logger.log('⏰ [CronJob] Bắt đầu quét tin tức chứng khoán mới từ CafeF & Investing.com...');
        const fetchedItems = await this.newsFetcherService.fetchAllNews();
        if (!fetchedItems || fetchedItems.length === 0) {
            this.logger.warn('[CronJob] Không thu thập được tin tức mới nào.');
            return;
        }
        const newItems = await this.newsService.saveAndFilterNewNews(fetchedItems);
        if (newItems.length > 0) {
            this.logger.log(`🔥 Phát hiện ${newItems.length} tin tức MỚI từ CafeF & Investing.com! Tiến hành phát thông báo...`);
            await this.telegramService.broadcastNews(newItems);
        }
        else {
            this.logger.log('✅ Không có tin tức mới phát sinh.');
        }
    }
};
exports.SchedulerService = SchedulerService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_MINUTE),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerService.prototype, "handleCron", null);
exports.SchedulerService = SchedulerService = SchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [news_fetcher_service_1.NewsFetcherService,
        news_service_1.NewsService,
        telegram_service_1.TelegramService])
], SchedulerService);
//# sourceMappingURL=scheduler.service.js.map