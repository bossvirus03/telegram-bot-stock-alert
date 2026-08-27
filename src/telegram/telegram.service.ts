import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf } from 'telegraf';
import { WatchlistService } from '../watchlist/watchlist.service';
import { StockService } from '../stock/stock.service';
import { NewsService } from '../news/news.service';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;

  constructor(
    private readonly configService: ConfigService,
    private readonly watchlistService: WatchlistService,
    private readonly stockService: StockService,
    private readonly newsService: NewsService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.error('TELEGRAM_BOT_TOKEN chưa được cấu hình trong file .env');
    } else {
      this.bot = new Telegraf(token);
    }
  }

  async onModuleInit() {
    if (!this.bot) return;

    this.registerCommands();
    this.bot.launch().then(() => {
      this.logger.log('🤖 Telegram Bot đã khởi chạy thành công và đang lắng nghe câu lệnh...');
    }).catch((err) => {
      this.logger.error(`Không thể kết nối Telegram Bot: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.bot) {
      try {
        this.bot.stop('SIGTERM');
        this.logger.log('🛑 Telegram Bot đã ngắt kết nối an toàn.');
      } catch (e) {}
    }
  }

  private registerCommands() {
    // 1. /start hoặc /help
    this.bot.command(['start', 'help'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      const helpMessage = `
📈 <b>CHÀO MỪNG ĐẾN VỚI BOT PHÂN TÍCH & DÒNG TIỀN CHỨNG KHOÁN VN</b> 🇻🇳

Các lệnh hỗ trợ:
➕ <code>/add MÃ</code> - Thêm cổ phiếu vào danh mục theo dõi (VD: <code>/add FPT</code>)
➖ <code>/remove MÃ</code> - Xóa cổ phiếu khỏi danh mục (VD: <code>/remove FPT</code>)
📋 <code>/watchlist</code> - Xem bảng giá & dòng tiền thời gian thực các mã đang theo dõi
🌊 <code>/flow MÃ</code> - Phân tích chuyên sâu dòng tiền Mua/Bán chủ động (VD: <code>/flow VNM</code>)
🔥 <code>/topflow</code> - Danh sách Top cổ phiếu thu hút Dòng tiền Mua ròng mạnh nhất
📰 <code>/news MÃ</code> - Xem tin tức mới nhất của mã cổ phiếu (VD: <code>/news HPG</code>)
ℹ️ <code>/help</code> - Hiển thị menu hướng dẫn này
      `;
      await ctx.replyWithHTML(helpMessage);
    });

    // 2. /add <SYMBOL>
    this.bot.command('add', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/add FPT</code>');
      }

      const symbol = parts[1].toUpperCase();
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;

      const result = await this.watchlistService.addSymbol(chatId, username, symbol);
      await ctx.replyWithHTML(result.message);
    });

    // 3. /remove <SYMBOL>
    this.bot.command('remove', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu cần xóa. Ví dụ: <code>/remove FPT</code>');
      }

      const symbol = parts[1].toUpperCase();
      const chatId = ctx.chat.id.toString();

      const result = await this.watchlistService.removeSymbol(chatId, symbol);
      await ctx.replyWithHTML(result.message);
    });

    // 4. /watchlist
    this.bot.command(['watchlist', 'danhdm'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const symbols = await this.watchlistService.getUserWatchlist(chatId);

      if (symbols.length === 0) {
        return ctx.replyWithHTML('📭 Danh mục theo dõi của bạn đang trống.\nSử dụng <code>/add MÃ</code> để thêm cổ phiếu (VD: <code>/add FPT</code>).');
      }

      await ctx.replyWithHTML('⌛ Đang tải dữ liệu dòng tiền real-time...');

      let responseText = `📊 <b>BẢNG GIÁ & DÒNG TIỀN THEO DÕI REAL-TIME</b>\n\n`;

      for (const sym of symbols) {
        const detail = await this.stockService.getStockDetail(sym);
        if (detail) {
          const icon = detail.change > 0 ? '🟢' : detail.change < 0 ? '🔴' : '🟡';
          const flowIcon = detail.flowTrend === 'BULLISH' ? '🔥 Mua ròng mạnh' : detail.flowTrend === 'BEARISH' ? '❄️ Bán ròng mạnh' : '⚖️ Cân bằng';

          responseText += `${icon} <b>${detail.symbol}</b>: <b>${detail.currentPrice}k</b> (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)\n`;
          responseText += `  • Mua CĐ: ${(detail.activeBuyVolume / 1000).toFixed(0)}k | Bán CĐ: ${(detail.activeSellVolume / 1000).toFixed(0)}k\n`;
          responseText += `  • Dòng tiền ròng: <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} tỷ</b> (${flowIcon})\n`;
          responseText += `  • Khối ngoại: ${detail.foreignNetBuyVolume > 0 ? 'Mua ròng' : 'Bán ròng'} ${Math.abs(Math.round(detail.foreignNetBuyVolume / 1000))}k CP\n\n`;
        }
      }

      await ctx.replyWithHTML(responseText);
    });

    // 5. /flow <SYMBOL>
    this.bot.command('flow', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/flow FPT</code>');
      }

      const symbol = parts[1].toUpperCase();
      const detail = await this.stockService.getStockDetail(symbol);

      if (!detail) {
        return ctx.replyWithHTML(`❌ Không tìm thấy thông tin cho mã <b>${symbol}</b>`);
      }

      const priceIcon = detail.change > 0 ? '🟢' : detail.change < 0 ? '🔴' : '🟡';
      const trendText = detail.flowTrend === 'BULLISH'
        ? '🚀 <b>DÒNG TIỀN TÍCH CỰC - MUA CHỦ ĐỘNG ÁP ĐẢO</b>'
        : detail.flowTrend === 'BEARISH'
        ? '🚨 <b>DÒNG TIỀN TIÊU CỰC - ÁP LỰC BÁN CHỦ ĐỘNG RỘNG</b>'
        : '⚖️ <b>DÒNG TIỀN GIẰNG CO TRONG BIÊN ĐỘ THẸP</b>';

      const message = `
🌊 <b>PHÂN TÍCH DÒNG TIỀN REAL-TIME - MÃ ${detail.symbol}</b>

${priceIcon} <b>Giá hiện tại:</b> ${detail.currentPrice},000 VNĐ (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)
📈 <b>Tham chiếu / Cao / Thấp:</b> ${detail.refPrice}k / ${detail.highPrice}k / ${detail.lowPrice}k
📊 <b>Tổng khối lượng giao dịch:</b> ${(detail.totalVolume / 1000).toFixed(0)}k CP

🛒 <b>Lệnh Mua Chủ Động:</b> ${(detail.activeBuyVolume / 1000).toFixed(0)}k CP
🔻 <b>Lệnh Bán Chủ Động:</b> ${(detail.activeSellVolume / 1000).toFixed(0)}k CP
💵 <b>Dòng tiền Mua/Bán Ròng:</b> <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ</b>

🏦 <b>Giao Dịch Khối Ngoại:</b>
  • Mua: ${(detail.foreignBuyVolume / 1000).toFixed(0)}k CP | Bán: ${(detail.foreignSellVolume / 1000).toFixed(0)}k CP
  • Ròng: <b>${detail.foreignNetBuyVolume > 0 ? '+' : ''}${(detail.foreignNetBuyVolume / 1000).toFixed(0)}k CP</b>

📌 <b>Đánh Giá:</b> ${trendText}
      `;

      await ctx.replyWithHTML(message);
    });

    // 6. /topflow
    this.bot.command('topflow', async (ctx) => {
      await ctx.replyWithHTML('⌛ Đang quét toàn thị trường tìm Top cổ phiếu thu hút dòng tiền...');

      const topList = await this.stockService.getTopFlowStocks();

      let msg = `🔥 <b>TOP CỔ PHIẾU DÒNG TIỀN MUA RÒNG MẠNH NHẤT</b>\n\n`;
      topList.forEach((item, index) => {
        const icon = item.changePercent > 0 ? '🟢' : item.changePercent < 0 ? '🔴' : '🟡';
        msg += `${index + 1}. ${icon} <b>${item.symbol}</b>: <b>${item.price}k</b> (${item.changePercent > 0 ? '+' : ''}${item.changePercent}%)\n`;
        msg += `   👉 Dòng tiền Mua ròng: <b>+${item.netActiveValueBillion} tỷ</b>\n`;
      });

      await ctx.replyWithHTML(msg);
    });

    // 7. /news <SYMBOL>
    this.bot.command('news', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/news HPG</code>');
      }

      const symbol = parts[1].toUpperCase();
      const articles = await this.newsService.getLatestNewsBySymbol(symbol);

      if (articles.length === 0) {
        return ctx.replyWithHTML(`📭 Chưa tìm thấy tin tức mới phát sinh liên quan tới mã <b>${symbol}</b>.`);
      }

      let msg = `📰 <b>TIN TỨC MỚI NHẤT LIÊN QUAN TỚI MÃ ${symbol}</b>\n\n`;
      for (const article of articles) {
        msg += `🔹 <b><a href="${article.url}">${article.title}</a></b>\n`;
        if (article.summary) {
          msg += `<i>${article.summary.slice(0, 150)}...</i>\n`;
        }
        msg += `📌 Nguồn: ${article.source} | ${new Date(article.createdAt).toLocaleTimeString('vi-VN')}\n\n`;
      }

      await ctx.replyWithHTML(msg, { link_preview_options: { is_disabled: false } });
    });
  }

  /**
   * Phương thức hỗ trợ gửi thông báo tự động từ Cron job tới Telegram Chat
   */
  async sendMessage(chatId: string, message: string) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      this.logger.error(`Lỗi khi gửi tin nhắn tới Telegram Chat ID ${chatId}: ${error.message}`);
    }
  }
}
