import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NewsService } from '../news/news.service';
import { WatchlistService } from '../watchlist/watchlist.service';
import { StockService } from '../stock/stock.service';
import { TelegramService } from '../telegram/telegram.service';
import { StockDetail } from '../stock/stock.interface';
import { Markup } from 'telegraf';
import { MacroService } from '../macro/macro.service';
import { GoldService } from '../gold/gold.service';
import { TelegramUser } from '@prisma/client';

@Injectable()
export class CronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronService.name);

  // Ghi nhớ giá trị dòng tiền đã báo trước đó cho từng user và mã cổ phiếu
  private readonly lastNotifiedFlowMap = new Map<string, number>();

  private newsIntervalId: NodeJS.Timeout | null = null;
  private flowIntervalId: NodeJS.Timeout | null = null;
  private macroTimeoutId: NodeJS.Timeout | null = null;
  private goldIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly newsService: NewsService,
    private readonly watchlistService: WatchlistService,
    private readonly stockService: StockService,
    private readonly telegramService: TelegramService,
    private readonly macroService: MacroService,
    private readonly goldService: GoldService,
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

    // 3. Vòng lặp theo dõi kinh tế vĩ mô tức thì (CPI/PPI/NFP/ForexFactory - Adaptive Fast Polling)
    setTimeout(() => {
      this.runMacroMonitoringCycle().catch((err) => {
        this.logger.error(`Lỗi khởi chạy Macro Monitor ban đầu: ${err.message}`);
      });
    }, 3000);

    // 4. Vòng lặp theo dõi RSI XAU/USD (Gold) đa khung thời gian (mỗi 25 giây)
    this.goldIntervalId = setInterval(() => {
      this.checkXauRsiAlerts().catch((err) => {
        this.logger.error(`Lỗi trong vòng lặp XAU RSI Monitor: ${err.message}`);
      });
    }, 25000);

    setTimeout(() => {
      this.checkXauRsiAlerts().catch((err) => {
        this.logger.error(`Lỗi khởi chạy XAU RSI ban đầu: ${err.message}`);
      });
    }, 8000);
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
    if (this.macroTimeoutId) {
      clearTimeout(this.macroTimeoutId);
      this.macroTimeoutId = null;
    }
    if (this.goldIntervalId) {
      clearInterval(this.goldIntervalId);
      this.goldIntervalId = null;
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

  // Ghi nhớ snapshot dữ liệu gần nhất của từng mã cổ phiếu để tính chênh lệch lệnh mới
  private readonly stockSnapshotMap = new Map<
    string,
    {
      totalVolume: number;
      activeBuyVolume: number;
      activeSellVolume: number;
      netActiveBuyValue: number;
      currentPrice: number;
      timestamp: number;
    }
  >();

  /**
   * Định dạng số tiền VNĐ dễ nhìn (Tỷ VNĐ hoặc Triệu VNĐ)
   */
  private formatMoneyVND(billion: number): string {
    const abs = Math.abs(billion);
    if (abs >= 1) {
      return `${abs.toFixed(2)} Tỷ VNĐ`;
    }
    const million = Math.round(abs * 1000);
    return `${million.toLocaleString('vi-VN')} Triệu VNĐ`;
  }

  /**
   * PHÁT HIỆN & THÔNG BÁO KHI CÓ LỆNH LỚN HOẶC DÒNG TIỀN ĐỘT BIẾN VÀO / RA TRONG PHIÊN
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

    // 4. Đối chiếu chênh lệch giữa 2 nhịp quét để phát hiện chính xác lệnh vừa vào
    for (const [symbol, detail] of stockDetailsMap.entries()) {
      const prev = this.stockSnapshotMap.get(symbol);

      // Nếu là lần đầu quét mã này sau khi bot khởi động -> Lưu làm mốc ban đầu, không báo giả
      if (!prev) {
        this.stockSnapshotMap.set(symbol, {
          totalVolume: detail.totalVolume,
          activeBuyVolume: detail.activeBuyVolume,
          activeSellVolume: detail.activeSellVolume,
          netActiveBuyValue: detail.netActiveBuyValue,
          currentPrice: detail.currentPrice,
          timestamp: Date.now(),
        });
        continue;
      }

      // Tính biến động phát sinh trong nhịp vừa qua (15 giây)
      const deltaVolume = Math.max(0, detail.totalVolume - prev.totalVolume);
      const deltaBuyVol = Math.max(0, detail.activeBuyVolume - prev.activeBuyVolume);
      const deltaSellVol = Math.max(0, detail.activeSellVolume - prev.activeSellVolume);
      const deltaNetValue = Number((detail.netActiveBuyValue - prev.netActiveBuyValue).toFixed(2));

      // Cập nhật snapshot mới nhất
      this.stockSnapshotMap.set(symbol, {
        totalVolume: detail.totalVolume,
        activeBuyVolume: detail.activeBuyVolume,
        activeSellVolume: detail.activeSellVolume,
        netActiveBuyValue: detail.netActiveBuyValue,
        currentPrice: detail.currentPrice,
        timestamp: Date.now(),
      });

      // Nếu không có khối lượng giao dịch mới phát sinh trong 15s qua -> Bỏ qua
      if (deltaVolume === 0 && deltaNetValue === 0) {
        continue;
      }

      // Xác định chiều của lệnh / nhịp khớp mới
      const isBuyDominant = deltaBuyVol > deltaSellVol || (detail.lastTradeSide === 'BUY' && deltaBuyVol > 0);
      const isSellDominant = deltaSellVol > deltaBuyVol || (detail.lastTradeSide === 'SELL' && deltaSellVol > 0);

      // Khối lượng và giá trị của LỆNH / NHỊP VỪA KHỚP
      const recentTradeVolume = isBuyDominant
        ? (deltaBuyVol > 0 ? deltaBuyVol : (detail.lastTradeVolume || deltaVolume))
        : (isSellDominant ? (deltaSellVol > 0 ? deltaSellVol : (detail.lastTradeVolume || deltaVolume)) : deltaVolume);

      const recentTradeValueBillion = Number(
        ((recentTradeVolume * detail.currentPrice * 1000) / 1000000000).toFixed(2),
      );

      // Tổng giá trị Mua / Bán lũy kế cả ngày từ đầu phiên
      const totalBuyValueBillion = Number(
        ((detail.activeBuyVolume * detail.currentPrice * 1000) / 1000000000).toFixed(2),
      );
      const totalSellValueBillion = Number(
        ((detail.activeSellVolume * detail.currentPrice * 1000) / 1000000000).toFixed(2),
      );

      const now = new Date();
      const timeStr = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(11, 19);

      // Tiêu chí báo động:
      // 1. Lệnh MUA lớn: Giá trị lệnh vừa vào >= 500 Triệu VNĐ (0.5 Tỷ) HOẶC Mua ròng nhịp này tăng >= 1.0 Tỷ VNĐ
      const isSignificantBuy = isBuyDominant && (recentTradeValueBillion >= 0.5 || deltaNetValue >= 1.0);

      // 2. Lệnh BÁN xả lớn: Giá trị lệnh vừa xả >= 500 Triệu VNĐ (0.5 Tỷ) HOẶC Bán ròng nhịp này xả >= 1.0 Tỷ VNĐ
      const isSignificantSell = isSellDominant && (recentTradeValueBillion >= 0.5 || deltaNetValue <= -1.0);

      if (!isSignificantBuy && !isSignificantSell) {
        continue;
      }

      // Gửi thông báo tới các user đang theo dõi mã này
      for (const user of userWatchlists) {
        if (!user.symbols.includes(symbol)) continue;

        if (isSignificantBuy) {
          const alertMessage = `
⚡ <b>PHÁT HIỆN LỆNH MUA LỚN VỪA VÀO - ${symbol}</b>

🟢 <b>Mã CP:</b> <b>${symbol}</b> | Giá khớp: <b>${detail.currentPrice}k</b> (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)

🎯 <b>CHI TIẾT LỆNH VỪA ĐẶT / KHỚP:</b>
• 💥 <b>Chiều lệnh:</b> 🟢 <b>MUA CHỦ ĐỘNG</b> (Khớp thẳng vào giá Bán)
• 💵 <b>Giá trị lệnh vừa vào:</b> <b>${this.formatMoneyVND(recentTradeValueBillion)}</b>
• 📦 <b>Khối lượng lệnh vừa khớp:</b> <b>${recentTradeVolume.toLocaleString('vi-VN')} CP</b>
• ⏱️ <b>Thời điểm khớp:</b> ${timeStr}
• 📈 <b>Chênh lệch Mua ròng nhịp này:</b> <b>+${Math.max(0.1, deltaNetValue)} Tỷ VNĐ</b>

📊 <b>BỐI CẢNH DÒNG TIỀN TOÀN PHIÊN (LŨY KẾ):</b>
• 🟢 Tổng Mua chủ động: <b>${this.formatMoneyVND(totalBuyValueBillion)}</b> (${detail.activeBuyVolume.toLocaleString('vi-VN')} CP)
• 🔴 Tổng Bán chủ động: <b>${this.formatMoneyVND(totalSellValueBillion)}</b> (${detail.activeSellVolume.toLocaleString('vi-VN')} CP)
• 🔥 <b>Dòng tiền Mua ròng cả phiên:</b> <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ</b>
• 🏷️ Trạng thái: <b>${detail.flowTrend === 'BULLISH' ? '🟢 Phe Mua áp đảo' : (detail.flowTrend === 'BEARISH' ? '🔴 Phe Bán chiếm ưu thế' : '⚪ Giằng co cân bằng')}</b>
          `.trim();

          await this.telegramService.sendMessage(user.chatId, alertMessage);
        } else if (isSignificantSell) {
          const alertMessage = `
🚨 <b>PHÁT HIỆN LỆNH BÁN XẢ LỚN - ${symbol}</b>

🔴 <b>Mã CP:</b> <b>${symbol}</b> | Giá khớp: <b>${detail.currentPrice}k</b> (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)

🎯 <b>CHI TIẾT LỆNH VỪA ĐẶT / KHỚP:</b>
• 💥 <b>Chiều lệnh:</b> 🔴 <b>BÁN CHỦ ĐỘNG</b> (Bán thẳng vào giá Mua)
• 💸 <b>Giá trị lệnh vừa xả:</b> <b>${this.formatMoneyVND(recentTradeValueBillion)}</b>
• 📦 <b>Khối lượng lệnh vừa khớp:</b> <b>${recentTradeVolume.toLocaleString('vi-VN')} CP</b>
• ⏱️ <b>Thời điểm khớp:</b> ${timeStr}
• 📉 <b>Chênh lệch Bán ròng nhịp này:</b> <b>${deltaNetValue} Tỷ VNĐ</b>

📊 <b>BỐI CẢNH DÒNG TIỀN TOÀN PHIÊN (LŨY KẾ):</b>
• 🟢 Tổng Mua chủ động: <b>${this.formatMoneyVND(totalBuyValueBillion)}</b> (${detail.activeBuyVolume.toLocaleString('vi-VN')} CP)
• 🔴 Tổng Bán chủ động: <b>${this.formatMoneyVND(totalSellValueBillion)}</b> (${detail.activeSellVolume.toLocaleString('vi-VN')} CP)
• 💥 <b>Dòng tiền Bán ròng cả phiên:</b> <b>${detail.netActiveBuyValue} Tỷ VNĐ</b>
• 🏷️ Trạng thái: <b>${detail.flowTrend === 'BULLISH' ? '🟢 Phe Mua áp đảo' : (detail.flowTrend === 'BEARISH' ? '🔴 Phe Bán chiếm ưu thế' : '⚪ Giằng co cân bằng')}</b>
          `.trim();

          await this.telegramService.sendMessage(user.chatId, alertMessage);
        }
      }
    }
  }

  /**
   * VÒNG LẶP THEO DÕI & CẢNH BÁO TỨC THÌ DỮ LIỆU KINH TẾ VĨ MÔ (CPI/PPI/NFP...)
   * Sử dụng cơ chế Adaptive Polling:
   * - 4 giây / lần: khi đang trong khung giờ vàng có tin CPI/PPI/NFP chuẩn bị ra hoặc vừa ra
   * - 30 giây / lần: khi ở ngoài khung giờ ra tin để tiết kiệm tài nguyên
   */
  async runMacroMonitoringCycle() {
    let nextDelayMs = 30000;

    try {
      // 1. Tải dữ liệu các sự kiện kinh tế
      const events = await this.macroService.fetchEvents();

      // 2. Tìm các sự kiện quan trọng vừa có kết quả Actual mà chưa từng báo
      const newlyReleased = this.macroService.getNewlyReleasedEvents(events);

      if (newlyReleased.length > 0) {
        const allUsers = await this.watchlistService.getAllUsers();

        for (const event of newlyReleased) {
          const analysis = this.macroService.analyzeEvent(event);
          const message = this.macroService.formatTelegramMessage(analysis);

          this.logger.log(
            `📢 PHÁT HIỆN SỐ LIỆU VĨ MÔ MỚI: ${event.country} - ${event.title} (Actual: ${event.actual} | Forecast: ${event.forecast} | Previous: ${event.previous})`,
          );

          // Broadcast ngay lập tức tới những người dùng Telegram có bật mức độ tương ứng
          let actuallySentCount = 0;
          for (const user of allUsers) {
            const macroAlertLevels = (user as any).macroAlertLevels;
            const userLevels =
              Array.isArray(macroAlertLevels) && macroAlertLevels.length > 0
                ? macroAlertLevels
                : [1, 0]; // Mặc định: Cao (1) và Trung bình (0)

            // Bỏ qua nếu người dùng không chọn nhận mức độ ảnh hưởng này
            if (!userLevels.includes(event.importance)) {
              continue;
            }

            try {
              await this.telegramService.sendMessage(user.chatId, message);
              actuallySentCount++;
            } catch (err: any) {
              this.logger.error(`Lỗi gửi tin vĩ mô tới user ${user.chatId}: ${err.message}`);
            }
          }

          this.logger.log(
            `📤 Đã phát cảnh báo sự kiện "${event.title}" (${event.country}) tới ${actuallySentCount}/${allUsers.length} người dùng phù hợp.`,
          );

          // Đánh dấu đã báo để không bao giờ gửi trùng
          await this.macroService.markEventAsAlerted(event);
        }
      }

      // 3. Tự động chuyển tần suất: Nếu có tin quan trọng sắp ra trong 5 phút tới -> Fast Polling 4s
      const hasPendingNear = this.macroService.hasPendingEventsNearRelease(events);
      if (hasPendingNear) {
        nextDelayMs = 4000; // Tăng tốc độ quét lên 4s để bắt số liệu tức thì!
        this.logger.debug('⚡ Chế độ Turbo Fast Polling (4s) đang kích hoạt cho sự kiện vĩ mô sắp công bố!');
      } else {
        nextDelayMs = 30000; // 30s bình thường
      }
    } catch (err: any) {
      this.logger.error(`Lỗi trong chu kỳ Macro Monitoring: ${err.message}`);
      nextDelayMs = 30000;
    } finally {
      // Lên lịch cho chu kỳ tiếp theo
      this.macroTimeoutId = setTimeout(() => {
        this.runMacroMonitoringCycle().catch((e) => {
          this.logger.error(`Lỗi kích hoạt chu kỳ Macro Monitoring tiếp theo: ${e.message}`);
        });
      }, nextDelayMs);
    }
  }

  /**
   * TỰ ĐỘNG QUÉT & PHÁT CẢNH BÁO TỨC THÌ KHI RSI XAU/USD VÀO VÙNG QUÁ MUA / QUÁ BÁN
   */
  async checkXauRsiAlerts() {
    try {
      const triggers = await this.goldService.checkAlertTriggers();
      if (!triggers || triggers.length === 0) return;

      const userSubscribers = await this.goldService.getAllUsersForAlert();
      if (userSubscribers.length === 0) return;

      for (const trigger of triggers) {
        const message = this.goldService.renderAlertMessage(trigger);
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('📊 Bảng giá & RSI Vàng', 'xau_view_overview'),
            Markup.button.callback('⚙️ Cài đặt cảnh báo RSI', 'xau_open_settings'),
          ],
        ]);

        let sentCount = 0;
        for (const { chatId, settings } of userSubscribers) {
          // Bỏ qua nếu user tắt nhận thông báo ở khung thời gian này
          if (!settings.timeframes.includes(trigger.timeframe)) {
            continue;
          }

          // Kiểm tra theo ngưỡng cấu hình của user
          if (trigger.alertType === 'OVERBOUGHT' && trigger.rsi < settings.overboughtRsi) {
            continue;
          }
          if (trigger.alertType === 'OVERSOLD' && trigger.rsi > settings.oversoldRsi) {
            continue;
          }

          try {
            await this.telegramService.sendMessage(chatId, message, keyboard);
            sentCount++;
          } catch (err: any) {
            this.logger.warn(`Không thể gửi cảnh báo XAU RSI tới ${chatId}: ${err.message}`);
          }
        }

        if (sentCount > 0) {
          this.logger.log(
            `🔔 Đã phát cảnh báo XAU/USD RSI [${trigger.timeframe} | ${trigger.alertType} | RSI: ${trigger.rsi}] tới ${sentCount} người dùng.`,
          );
        }
      }
    } catch (e: any) {
      this.logger.error(`Lỗi thực thi checkXauRsiAlerts: ${e.message}`);
    }
  }
}

