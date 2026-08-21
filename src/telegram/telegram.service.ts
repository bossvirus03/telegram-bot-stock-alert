import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Context } from 'telegraf';
import { PrismaService } from '../prisma/prisma.service';
import { NewsService } from '../news/news.service';
import { NewsItem } from '../news/news.interface';
import { News } from '@prisma/client';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot?: Telegraf;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly newsService: NewsService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token || token.includes('YOUR_TELEGRAM_BOT_TOKEN')) {
      this.logger.warn('TELEGRAM_BOT_TOKEN chưa được cấu hình. Vui lòng cập nhật token thực trong .env để khởi chạy Telegram Bot.');
    } else {
      this.bot = new Telegraf(token);
    }
  }

  async onModuleInit() {
    if (!this.bot) return;

    this.registerCommands();
    try {
      await this.bot.launch();
      this.logger.log('🤖 Telegram Bot đã khởi chạy và bắt đầu lắng nghe tin nhắn!');
    } catch (err) {
      this.logger.error(`Không thể kết nối Telegram Bot: ${err.message}`);
    }
  }

  onModuleDestroy() {
    if (this.bot) {
      this.bot.stop('SIGINT');
    }
  }

  /**
   * Đăng ký các lệnh slash commands cho Telegram Bot
   */
  private registerCommands() {
    if (!this.bot) return;

    // Lệnh /start
    this.bot.start(async (ctx: Context) => {
      if (!ctx.chat) return;
      const chatId = ctx.chat.id.toString();
      const chatType = ctx.chat.type;

      await this.prisma.subscription.upsert({
        where: { chatId: chatId },
        update: { isSubscribed: true, chatType: chatType },
        create: { chatId: chatId, chatType: chatType, isSubscribed: true },
      });

      const message =
        `📈 <b>Chào mừng bạn đến với Stock News Bot!</b>\n\n` +
        `Bot sẽ tự động cập nhật tin tức chứng khoán mới nhất từ các trang uy tín như <b>CafeF</b>.\n\n` +
        `<b>Danh sách câu lệnh khả dụng:</b>\n` +
        `• /latest - Xem 5 tin tức mới nhất\n` +
        `• /stock &lt;MÃ&gt; - Xem tin tức theo mã cổ phiếu (VD: <code>/stock SSI</code>)\n` +
        `• /subscribe - Đăng ký nhận thông báo tự động\n` +
        `• /unsubscribe - Tắt nhận thông báo tự động\n` +
        `• /help - Hướng dẫn sử dụng`;

      await ctx.replyWithHTML(message);
    });

    // Lệnh /help
    this.bot.help((ctx: Context) => {
      const message =
        `ℹ️ <b>Hướng dẫn sử dụng Stock News Bot:</b>\n\n` +
        `1. Bot tự động quét tin tức mỗi 1-3 phút.\n` +
        `2. Bạn đã được tự động đăng ký nhận tin khi bấm /start.\n` +
        `3. Gõ <code>/stock SSI</code> hoặc <code>/stock HPG</code> để lọc tin cổ phiếu cụ thể.`;
      return ctx.replyWithHTML(message);
    });

    // Lệnh /subscribe
    this.bot.command('subscribe', async (ctx: Context) => {
      if (!ctx.chat) return;
      const chatId = ctx.chat.id.toString();
      await this.prisma.subscription.upsert({
        where: { chatId: chatId },
        update: { isSubscribed: true },
        create: { chatId: chatId, isSubscribed: true },
      });
      await ctx.replyWithHTML('✅ <b>Đã bật nhận thông báo tin tức chứng khoán tự động!</b>');
    });

    // Lệnh /unsubscribe
    this.bot.command('unsubscribe', async (ctx: Context) => {
      if (!ctx.chat) return;
      const chatId = ctx.chat.id.toString();
      await this.prisma.subscription.updateMany({
        where: { chatId: chatId },
        data: { isSubscribed: false },
      });
      await ctx.replyWithHTML('🔕 <b>Đã tắt nhận thông báo tự động.</b> Bấm /subscribe khi muốn bật lại.');
    });

    // Lệnh /latest
    this.bot.command('latest', async (ctx: Context) => {
      const latestNews = await this.newsService.getLatestNews(5);
      if (!latestNews || latestNews.length === 0) {
        return ctx.reply('Chưa có tin tức mới trong hệ thống. Vui lòng thử lại sau.');
      }

      for (const item of latestNews) {
        await ctx.replyWithHTML(this.formatNewsMessage(item));
      }
    });

    // Lệnh /stock <MÃ>
    this.bot.command('stock', async (ctx: Context) => {
      const text = (ctx.message as any)?.text || '';
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

  /**
   * Phát thông báo tin tức mới tới tất cả các subscriber đã đăng ký
   */
  async broadcastNews(newsList: NewsItem[]) {
    if (!this.bot || newsList.length === 0) return;

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
        } catch (error) {
          this.logger.error(`Không thể gửi tin nhắn đến Chat ID ${sub.chatId}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Định dạng tin nhắn HTML hiển thị tin tức
   */
  private formatNewsMessage(news: NewsItem | News): string {
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

    html += `🏛️ <b>Nguồn:</b> ${news.source || 'CafeF'}\n`;
    if (formattedDate) {
      html += `⏰ <b>Thời gian:</b> ${formattedDate}\n`;
    }

    html += `\n🔗 <a href="${news.url}">Đọc bài viết chi tiết tại CafeF</a>`;

    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
