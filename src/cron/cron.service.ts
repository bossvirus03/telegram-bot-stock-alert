import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NewsService } from '../news/news.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { StockService } from '../stock/stock.service';
import { TelegramService } from '../telegram/telegram.service';
import { Markup } from 'telegraf';

@Injectable()
export class CronService implements OnModuleInit {
  private readonly logger = new Logger(CronService.name);

  // Ghi nhớ giá trị dòng tiền đã báo trước đó cho từng user và mã cổ phiếu
  private readonly lastNotifiedFlowMap = new Map<string, number>();

  constructor(
    private readonly newsService: NewsService,
    private readonly watchlistService: WatchlistService,
    private readonly stockService: StockService,
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit() {
    // 1. Vòng lặp quét tin tức chứng khoán tự động TỨC THÌ (mỗi 20 giây)
    setInterval(() => {
      this.handleAutoNewsBroadcast().catch((err) => {
        this.logger.error(`Lỗi tự động quét tin tức: ${err.message}`);
      });
    }, 20000);

    // 2. Vòng lặp quét dòng tiền lớn TỨC THÌ (mỗi 10 giây)
    setInterval(() => {
      this.checkInstantFlowAlerts().catch((err) => {
        this.logger.error(`Lỗi trong vòng lặp Instant Flow Monitor: ${err.message}`);
      });
    }, 10000);
  }

  /**
   * TỰ ĐỘNG CÀO & PHÁT THÔNG BÁO TIN TỨC CHỨNG KHOÁN MỚI TỨC THÌ
   */
  async handleAutoNewsBroadcast() {
    // 1. Quét tin tức mới từ CafeF / Vietstock
    await this.newsService.fetchAndStoreLatestNews();

    // 2. Lấy danh sách tất cả các tin tức chưa gửi
    const unsentArticles = await this.newsService.getUnsentNewsAll();
    if (unsentArticles.length === 0) return;

    // 3. Lấy tất cả Telegram Users đã kích hoạt bot
    const allUsers = await this.watchlistService.getAllUsers();
    if (allUsers.length === 0) {
      this.logger.warn('Chưa có Telegram User nào tương tác với Bot (gửi /start). Tạm ngưng đánh dấu đã gửi tin.');
      return;
    }

    // 4. Lấy danh mục cổ phiếu theo dõi của từng user
    const userWatchlists = await this.watchlistService.getAllUsersWatchlist();
    const watchlistMap = new Map<string, string[]>();
    userWatchlists.forEach((item) => watchlistMap.set(item.chatId, item.symbols));

    const sentArticleIds = new Set<number>();

    for (const article of unsentArticles) {
      const hasSpecificSymbols = article.symbols && article.symbols.length > 0;
      let actuallySentCount = 0;

      for (const user of allUsers) {
        const userSymbols = watchlistMap.get(user.chatId) || [];
        const isMatchedWatchlist = hasSpecificSymbols && article.symbols.some((s) => userSymbols.includes(s));

        // CHỈ phát thông báo ngầm nếu tin thuộc các mã cổ phiếu User đã bấm /add vào danh mục
        if (!isMatchedWatchlist) {
          continue;
        }

        const matchedSyms = article.symbols.filter((s) => userSymbols.includes(s)).join(', ');
        const headerText = `🔔 <b>TIN NÓNG CỔ PHIẾU BẠN THEO DÕI [${matchedSyms}]</b>`;

        const pubDate = new Date(article.publishedAt || article.createdAt);
        const dateStr = pubDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = pubDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

        const message = `
${headerText}

🔹 <b>${article.title}</b>
${article.summary && article.summary !== article.title ? `<i>${article.summary.slice(0, 180)}...</i>\n` : ''}
📅 <b>Ngày ra tin:</b> ${dateStr} ${timeStr} | 📌 Nguồn: <b>${article.source}</b>
        `.trim();

        const keyboard = Markup.inlineKeyboard([
          [Markup.button.url(`🔗 Đọc ngay: ${article.title.slice(0, 30)}...`, article.url)],
        ]);

        await this.telegramService.sendMessage(user.chatId, message, keyboard);
        actuallySentCount++;
      }

      if (actuallySentCount > 0) {
        sentArticleIds.add(article.id);
      }
    }

    // 5. Đánh dấu các tin đã thực sự được gửi đi
    if (sentArticleIds.size > 0) {
      await this.newsService.markNewsAsSent(Array.from(sentArticleIds));
      this.logger.log(`📢 Đã gửi thành công ${sentArticleIds.size} tin tức chứng khoán tới ${allUsers.length} Telegram User!`);
    }
  }

  /**
   * PHÁT HIỆN & THÔNG BÁO TỨC THÌ (REALTIME 10S) KHI CÓ DÒNG TIỀN LỚN VÀO / RA
   */
  async checkInstantFlowAlerts() {
    const userWatchlists = await this.watchlistService.getAllUsersWatchlist();
    if (userWatchlists.length === 0) return;

    for (const user of userWatchlists) {
      for (const symbol of user.symbols) {
        const detail = await this.stockService.getStockDetail(symbol);
        if (!detail) continue;

        const mapKey = `${user.chatId}_${symbol}`;
        const prevNetValue = this.lastNotifiedFlowMap.get(mapKey) ?? 0;
        const currentNetValue = detail.netActiveBuyValue;

        // 1. DÒNG TIỀN MUA LỚN VÀO (Mua ròng >= 3.0 Tỷ VNĐ)
        if (currentNetValue >= 3.0 && (currentNetValue - prevNetValue >= 1.5 || prevNetValue === 0)) {
          const alertMessage = `
⚡ <b>DÒNG TIỀN LỚN MUA VÀO TỨC THÌ - ${symbol}</b>

🟢 <b>Mã:</b> ${symbol} | <b>Giá:</b> ${detail.currentPrice}k (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)
🔥 <b>Dòng tiền Mua ròng chủ động:</b> <b>+${currentNetValue} Tỷ VNĐ</b>
🛒 <b>Khối lượng Mua CĐ:</b> ${(detail.activeBuyVolume / 1000).toFixed(0)}k CP
🔻 <b>Khối lượng Bán CĐ:</b> ${(detail.activeSellVolume / 1000).toFixed(0)}k CP
🏛️ <b>Khối ngoại:</b> ${detail.foreignNetBuyVolume > 0 ? 'Mua ròng' : 'Bán ròng'} ${Math.abs(Math.round(detail.foreignNetBuyVolume / 1000))}k CP

⚡ <i>Tín hiệu realtime: Tiền lớn vừa bơm mạnh vào cổ phiếu ${symbol}!</i>
          `;

          await this.telegramService.sendMessage(user.chatId, alertMessage);
          this.lastNotifiedFlowMap.set(mapKey, currentNetValue);
        }

        // 2. DÒNG TIỀN BÁN LỚN XẢ OUT (Bán ròng <= -3.0 Tỷ VNĐ)
        else if (currentNetValue <= -3.0 && (currentNetValue - prevNetValue <= -1.5 || prevNetValue === 0)) {
          const alertMessage = `
🚨 <b>DÒNG TIỀN LỚN BÁN THÁO TỨC THÌ - ${symbol}</b>

🔴 <b>Mã:</b> ${symbol} | <b>Giá:</b> ${detail.currentPrice}k (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)
💥 <b>Dòng tiền Bán ròng chủ động:</b> <b>${currentNetValue} Tỷ VNĐ</b>
🔻 <b>Khối lượng Bán CĐ:</b> ${(detail.activeSellVolume / 1000).toFixed(0)}k CP
🛒 <b>Khối lượng Mua CĐ:</b> ${(detail.activeBuyVolume / 1000).toFixed(0)}k CP
🏛️ <b>Khối ngoại:</b> ${detail.foreignNetBuyVolume > 0 ? 'Mua ròng' : 'Bán ròng'} ${Math.abs(Math.round(detail.foreignNetBuyVolume / 1000))}k CP

⚠️ <i>Tín hiệu realtime: Áp lực bán lớn vừa xả tháo chạy khỏi ${symbol}!</i>
          `;

          await this.telegramService.sendMessage(user.chatId, alertMessage);
          this.lastNotifiedFlowMap.set(mapKey, currentNetValue);
        }
      }
    }
  }
}
