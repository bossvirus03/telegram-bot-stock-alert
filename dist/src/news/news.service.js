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
var NewsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
let NewsService = NewsService_1 = class NewsService {
    prisma;
    logger = new common_1.Logger(NewsService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async saveAndFilterNewNews(items) {
        const newItems = [];
        for (const item of items) {
            try {
                const existing = await this.prisma.news.findUnique({
                    where: { url: item.url },
                });
                if (!existing) {
                    await this.prisma.news.create({
                        data: {
                            title: item.title,
                            url: item.url,
                            summary: item.summary,
                            imageUrl: item.imageUrl,
                            source: item.source,
                            tickers: item.tickers,
                            publishedAt: item.publishedAt,
                        },
                    });
                    newItems.push(item);
                }
            }
            catch (error) {
                this.logger.error(`Lỗi khi lưu tin tức [${item.url}]: ${error.message}`);
            }
        }
        return newItems;
    }
    async getLatestNews(limit = 10) {
        return this.prisma.news.findMany({
            orderBy: { publishedAt: 'desc' },
            take: limit,
        });
    }
    async searchNewsByTicker(ticker, limit = 10) {
        const upperTicker = ticker.toUpperCase();
        return this.prisma.news.findMany({
            where: {
                tickers: {
                    has: upperTicker,
                },
            },
            orderBy: { publishedAt: 'desc' },
            take: limit,
        });
    }
};
exports.NewsService = NewsService;
exports.NewsService = NewsService = NewsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], NewsService);
//# sourceMappingURL=news.service.js.map