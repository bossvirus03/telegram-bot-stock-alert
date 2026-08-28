import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NewsService } from '../news/news.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { StockService } from '../stock/stock.service';
import { TelegramService } from '../telegram/telegram.service';
import { StockDetail } from '../stock/stock.interface';
import { Markup } from 'telegraf';

@Injectable()
export class CronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronService.name);

  // Ghi nhớ giá trị dòng tiền đã báo trước đó cho từng user và mã cổ phiếu
  private readonly lastNotifiedFlowMap = new Map<string, number>();

  private newsIntervalId: NodeJS.Timeout | null = null;
  private flowIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly newsService: NewsService,
    private readonly watchlistService: WatchlistService,
    private readonly stockService: StockService,
    private readonly telegramService: TelegramService,
  ) {}

  onModuleInit() {
    // 1. Vòng lặp quét tin tức chứng khoán tự động (mỗi 60 giây)
    this.newsIntervalId = setInterval(() => {
      this.handleAutoNewsBroadcast().catch((err) => {
        this.logger.error(`Lỗi tự động quét tin tức: ${err.message}`);
      });
    }, 60000);

    // Chạy lần đầu ngay sau khi khởi động 5 giây
    setTimeout(() => {
      this.handleAutoNewsBroadcast().catch((err) => {
        this.logger.error(`Lỗi khởi chạy quét tin tức ban đầu: ${err.message}`);
      });
    }, 5000);

    // 2. Vòng lặp quét dòng tiền lớn trong phiên giao dịch (mỗi 15 giây)
    this.flowIntervalId = setInterval(() => {
      this.checkInstantFlowAlerts().catch((err) => {
        this.logger.error(`Lỗi trong vòng lặp Instant Flow Monitor: ${err.message}`);
      });
    }, 15000);
  }

  onModuleDestroy() {
    if (this.newsIntervalId) {
      clearInterval(this.newsIntervalId);
      this.newsIntervalId = null;
    }
    if (this.flowIntervalId) {
      clearInterval(this.flowIntervalId);
      this.flowIntervalId = null;
    }
    this.logger.log('🛑 Cron service đã hủy tất cả background timers an toàn.');
  }

  /**
   * Kiểm tra xem thị trường chứng khoán Việt Nam có đang trong phiên giao dịch hay không
   * (Sáng: 9h00 - 11h35, Chiều: 13h00 - 15h05, Thứ 2 - Thứ 6 theo giờ VN UTC+7)
   */
  private isVietnamStockMarketOpen(): boolean {
    const now = new Date();
    const utc = now.getTime() + now.getTimezoneOffset() * 60000;
    const vnTime = new Date(utc + 3600000 * 7);
    const dayOfWeek = vnTime.getDay(); // 0 = Chủ nhật, 6 = Thứ 7

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return false; // Cuối tuần sàn đóng cửa
    }

    const hours = vnTime.getHours();
    const minutes = vnTime.getMinutes();
    const timeInMinutes = hours * 60 + minutes;

    // Phiên sáng: 9h00 - 11h35 (540 - 695 phút)
    const isMorningSession = timeInMinutes >= 540 && timeInMinutes <= 695;
    // Phiên chiều: 13h00 - 15h05 (780 - 905 phút)
    const isAfternoonSession = timeInMinutes >= 780 && timeInMinutes <= 905;

    return isMorningSession || isAfternoonSession;
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
   * PHÁT HIỆN & THÔNG BÁO KHI CÓ DÒNG TIỀN ĐỘT BIẾN VÀO / RA TRONG PHIÊN
   */
  async checkInstantFlowAlerts() {
    // 1. Kiểm tra giờ giao dịch thị trường chứng khoán Việt Nam
    if (!this.isVietnamStockMarketOpen()) {
      return;
    }

    const userWatchlists = await this.watchlistService.getAllUsersWatchlist();
    if (userWatchlists.length === 0) return;

    // 2. Gom nhóm danh sách các mã duy nhất (distinct symbols) để gọi API 1 lần duy nhất
    const uniqueSymbols = new Set<string>();
    for (const user of userWatchlists) {
      user.symbols.forEach((s) => uniqueSymbols.add(s.toUpperCase()));
    }

    if (uniqueSymbols.size === 0) return;

    // 3. Tải thông tin song song cho từng mã cổ phiếu
    const stockDetailsMap = new Map<string, StockDetail>();
    await Promise.all(
      Array.from(uniqueSymbols).map(async (symbol) => {
        try {
          const detail = await this.stockService.getStockDetail(symbol);
          if (detail && detail.currentPrice > 0) {
            stockDetailsMap.set(symbol, detail);
          }
        } catch (e) {
          // Bỏ qua lỗi kết nối từng mã riêng lẻ
        }
      }),
    );

    // 4. Đối chiếu và phát cảnh báo cho từng User
    for (const user of userWatchlists) {
      for (const symbol of user.symbols) {
        const detail = stockDetailsMap.get(symbol.toUpperCase());
        if (!detail) continue;

        const mapKey = `${user.chatId}_${symbol.toUpperCase()}`;
        const prevNetValue = this.lastNotifiedFlowMap.get(mapKey) ?? 0;
        const currentNetValue = detail.netActiveBuyValue;

        // Tính giá trị tiền cho lệnh mua và bán chủ động (đơn vị: Tỷ VNĐ)
        const buyValueBillion = Number(((detail.activeBuyVolume * detail.currentPrice * 1000) / 1000000000).toFixed(2));
        const sellValueBillion = Number(((detail.activeSellVolume * detail.currentPrice * 1000) / 1000000000).toFixed(2));

        // 1. DÒNG TIỀN MUA LỚN VÀO (Mua ròng >= 3.0 Tỷ VNĐ)
        if (currentNetValue >= 3.0 && (currentNetValue - prevNetValue >= 1.5 || prevNetValue === 0)) {
          const alertMessage = `
⚡ <b>PHÁT HIỆN DÒNG TIỀN MUA VÀO - ${symbol.toUpperCase()}</b>

🟢 <b>Mã CP:</b> <b>${symbol.toUpperCase()}</b>
💵 <b>Giá trị Mua chủ động:</b> <b>${buyValueBillion >= 1 ? `${buyValueBillion} Tỷ VNĐ` : `${(buyValueBillion * 1000).toFixed(0)} Triệu VNĐ`}</b>
📦 <b>Khối lượng Mua:</b> <b>${detail.activeBuyVolume.toLocaleString('vi-VN')} CP</b>
🏷️ <b>Mức giá:</b> ${detail.currentPrice}k (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)
🔥 <b>Dòng tiền Mua ròng:</b> <b>+${currentNetValue} Tỷ VNĐ</b>
          `.trim();

          await this.telegramService.sendMessage(user.chatId, alertMessage);
          this.lastNotifiedFlowMap.set(mapKey, currentNetValue);
        }

        // 2. DÒNG TIỀN BÁN LỚN XẢ OUT (Bán ròng <= -3.0 Tỷ VNĐ)
        else if (currentNetValue <= -3.0 && (currentNetValue - prevNetValue <= -1.5 || prevNetValue === 0)) {
          const alertMessage = `
🚨 <b>PHÁT HIỆN DÒNG TIỀN BÁN XẢ - ${symbol.toUpperCase()}</b>

🔴 <b>Mã CP:</b> <b>${symbol.toUpperCase()}</b>
💸 <b>Giá trị Bán chủ động:</b> <b>${sellValueBillion >= 1 ? `${sellValueBillion} Tỷ VNĐ` : `${(sellValueBillion * 1000).toFixed(0)} Triệu VNĐ`}</b>
📦 <b>Khối lượng Bán:</b> <b>${detail.activeSellVolume.toLocaleString('vi-VN')} CP</b>
🏷️ <b>Mức giá:</b> ${detail.currentPrice}k (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)
💥 <b>Dòng tiền Bán ròng:</b> <b>${currentNetValue} Tỷ VNĐ</b>
          `.trim();

          await this.telegramService.sendMessage(user.chatId, alertMessage);
          this.lastNotifiedFlowMap.set(mapKey, currentNetValue);
        }
      }
    }
  }
}
