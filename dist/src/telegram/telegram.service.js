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
var TelegramService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelegramService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const telegraf_1 = require("telegraf");
const prisma_service_1 = require("../prisma/prisma.service");
const news_service_1 = require("../news/news.service");
let TelegramService = TelegramService_1 = class TelegramService {
    configService;
    prisma;
    newsService;
    logger = new common_1.Logger(TelegramService_1.name);
    bot;
    constructor(configService, prisma, newsService) {
        this.configService = configService;
        this.prisma = prisma;
        this.newsService = newsService;
        const token = this.configService.get('TELEGRAM_BOT_TOKEN');
        if (!token || token.includes('YOUR_TELEGRAM_BOT_TOKEN')) {
            this.logger.warn('TELEGRAM_BOT_TOKEN chưa được cấu hình. Vui lòng cập nhật token thực trong .env để khởi chạy Telegram Bot.');
        }
        else {
            this.bot = new telegraf_1.Telegraf(token);
        }
    }
    async onModuleInit() {
        if (!this.bot)
            return;
        this.registerCommands();
        try {
            await this.bot.launch();
            this.logger.log('🤖 Telegram Bot đã khởi chạy và bắt đầu lắng nghe tin nhắn!');
        }
        catch (err) {
            this.logger.error(`Không thể kết nối Telegram Bot: ${err.message}`);
        }
    }
    onModuleDestroy() {
        if (this.bot) {
            this.bot.stop('SIGINT');
        }
    }
    registerCommands() {
        if (!this.bot)
            return;
        this.bot.start(async (ctx) => {
            if (!ctx.chat)
                return;
            const chatId = ctx.chat.id.toString();
            const chatType = ctx.chat.type;
            await this.prisma.subscription.upsert({
                where: { chatId: chatId },
                update: { isSubscribed: true, chatType: chatType },
                create: { chatId: chatId, chatType: chatType, isSubscribed: true },
            });
            const message = `📈 <b>Chào mừng bạn đến với Stock News Bot!</b>\n\n` +
                `Bot tự động cập nhật tin tức chứng khoán mới nhất từ các nguồn uy tín <b>CafeF</b> và <b>Investing.com Việt Nam</b>.\n\n` +
                `<b>Danh sách câu lệnh khả dụng:</b>\n` +
                `• /latest - Xem 5 tin tức mới nhất\n` +
                `• /stock &lt;MÃ&gt; - Xem tin tức theo mã cổ phiếu (VD: <code>/stock SSI</code> hoặc <code>/stock HPG</code>)\n` +
                `• /subscribe - Đăng ký nhận thông báo tự động\n` +
                `• /unsubscribe - Tắt nhận thông báo tự động\n` +
                `• /help - Hướng dẫn sử dụng`;
            await ctx.replyWithHTML(message);
        });
        this.bot.help((ctx) => {
            const message = `ℹ️ <b>Hướng dẫn sử dụng Stock News Bot:</b>\n\n` +
                `1. Bot tự động quét tin tức từ CafeF và Investing.com định kỳ mỗi 1-3 phút.\n` +
                `2. Bạn đã được tự động đăng ký nhận tin khi bấm /start.\n` +
                `3. Gõ <code>/stock SSI</code> hoặc <code>/stock VNM</code> để lọc tin cổ phiếu cụ thể.`;
            return ctx.replyWithHTML(message);
        });
        this.bot.command('subscribe', async (ctx) => {
            if (!ctx.chat)
                return;
            const chatId = ctx.chat.id.toString();
            await this.prisma.subscription.upsert({
                where: { chatId: chatId },
                update: { isSubscribed: true },
                create: { chatId: chatId, isSubscribed: true },
            });
            await ctx.replyWithHTML('✅ <b>Đã bật nhận thông báo tin tức chứng khoán tự động!</b>');
        });
        this.bot.command('unsubscribe', async (ctx) => {
            if (!ctx.chat)
                return;
            const chatId = ctx.chat.id.toString();
            await this.prisma.subscription.updateMany({
                where: { chatId: chatId },
                data: { isSubscribed: false },
            });
            await ctx.replyWithHTML('🔕 <b>Đã tắt nhận thông báo tự động.</b> Bấm /subscribe khi muốn bật lại.');
        });
        this.bot.command('latest', async (ctx) => {
            const latestNews = await this.newsService.getLatestNews(5);
            if (!latestNews || latestNews.length === 0) {
                return ctx.reply('Chưa có tin tức mới trong hệ thống. Vui lòng thử lại sau.');
            }
            for (const item of latestNews) {
                await ctx.replyWithHTML(this.formatNewsMessage(item));
            }
        });
        this.bot.command('stock', async (ctx) => {
            const text = ctx.message?.text || '';
            const parts = text.trim().split(/\s+/);
            if (parts.length < 2) {
                return ctx.reply('Vui lòng nhập mã cổ phiếu. Ví dụ: /stock SSI');
            }
            const symbol = parts[1].toUpperCase();
            const newsList = await this.newsService.searchNewsByTicker(symbol, 5);
            if (!newsList || newsList.length === 0) {
                return ctx.replyWithHTML(`Không tìm thấy tin tức gần đây cho mã cổ phiếu <b>${symbol}</b>.`);
            }
            await ctx.replyWithHTML(`🔍 <b>Tin tức mới nhất về mã ${symbol}:</b>`);
            for (const item of newsList) {
                await ctx.replyWithHTML(this.formatNewsMessage(item));
            }
        });
    }
    async broadcastNews(newsList) {
        if (!this.bot || newsList.length === 0)
            return;
        const subscribers = await this.prisma.subscription.findMany({
            where: { isSubscribed: true },
        });
        if (subscribers.length === 0) {
            this.logger.log('Không có người dùng/kênh nào đăng ký nhận thông báo.');
            return;
        }
        for (const news of newsList) {
            const htmlMsg = this.formatNewsMessage(news);
            for (const sub of subscribers) {
                try {
                    await this.bot.telegram.sendMessage(sub.chatId, htmlMsg, { parse_mode: 'HTML' });
                }
                catch (error) {
                    this.logger.error(`Không thể gửi tin nhắn đến Chat ID ${sub.chatId}: ${error.message}`);
                }
            }
        }
    }
    formatNewsMessage(news) {
        const formattedDate = news.publishedAt
            ? new Date(news.publishedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
            : '';
        const tickersStr = news.tickers && news.tickers.length > 0
            ? news.tickers.map((t) => `#${t}`).join(' ')
            : '';
        let html = `📰 <b><a href="${news.url}">${this.escapeHtml(news.title)}</a></b>\n\n`;
        if (news.summary) {
            const cleanSummary = news.summary.length > 250
                ? news.summary.substring(0, 250) + '...'
                : news.summary;
            html += `<i>${this.escapeHtml(cleanSummary)}</i>\n\n`;
        }
        if (tickersStr) {
            html += `🏷️ <b>Mã liên quan:</b> ${tickersStr}\n`;
        }
        html += `🏛️ <b>Nguồn:</b> ${news.source || 'Investing.com / CafeF'}\n`;
        if (formattedDate) {
            html += `⏰ <b>Thời gian:</b> ${formattedDate}\n`;
        }
        html += `\n🔗 <a href="${news.url}">Đọc bài viết chi tiết</a>`;
        return html;
    }
    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};
exports.TelegramService = TelegramService;
exports.TelegramService = TelegramService = TelegramService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService,
        prisma_service_1.PrismaService,
        news_service_1.NewsService])
], TelegramService);
//# sourceMappingURL=telegram.service.js.map