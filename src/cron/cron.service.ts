import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { WatchlistService } from '../watchlist/watchlist.service';
import { TelegramService } from '../telegram/telegram.service';
import { Markup } from 'telegraf';
import { MacroService } from '../macro/macro.service';
import { GoldService } from '../gold/gold.service';
import { AlertService } from '../alert/alert.service';
import { IndicatorService } from '../indicator/indicator.service';
import { TelegramUser } from '@prisma/client';

@Injectable()
export class CronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CronService.name);

  private macroTimeoutId: NodeJS.Timeout | null = null;
  private goldIntervalId: NodeJS.Timeout | null = null;
  private priceAlertIntervalId: NodeJS.Timeout | null = null;
  private emaAlertIntervalId: NodeJS.Timeout | null = null;

  constructor(
    private readonly watchlistService: WatchlistService,
    private readonly telegramService: TelegramService,
    private readonly macroService: MacroService,
    private readonly goldService: GoldService,
    private readonly alertService: AlertService,
    private readonly indicatorService: IndicatorService,
  ) {}

  onModuleInit() {
    // 1. Vòng lặp theo dõi kinh tế vĩ mô tức thì (CPI/PPI/NFP/ForexFactory - Adaptive Fast Polling)
    setTimeout(() => {
      this.runMacroMonitoringCycle().catch((err) => {
        this.logger.error(`Lỗi khởi chạy Macro Monitor ban đầu: ${err.message}`);
      });
    }, 3000);

    // 2. Vòng lặp theo dõi RSI XAU/USD (Gold) đa khung thời gian (mỗi 25 giây)
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

    // 3. Vòng lặp theo dõi Cảnh báo giá tức thì (XAU, BTC, Crypto) (mỗi 12 giây)
    this.priceAlertIntervalId = setInterval(() => {
      this.alertService.checkAllActiveAlerts().catch((err) => {
        this.logger.error(`Lỗi trong vòng lặp Price Alert Monitor: ${err.message}`);
      });
    }, 12000);

    setTimeout(() => {
      this.alertService.checkAllActiveAlerts().catch((err) => {
        this.logger.error(`Lỗi khởi chạy Price Alert ban đầu: ${err.message}`);
      });
    }, 4000);

    // 4. Vòng lặp theo dõi Cảnh báo Giao cắt EMA đa khung thời gian (mỗi 20 giây)
    this.emaAlertIntervalId = setInterval(() => {
      this.indicatorService.checkAllActiveEmaAlerts().catch((err) => {
        this.logger.error(`Lỗi trong vòng lặp EMA Cross Monitor: ${err.message}`);
      });
    }, 20000);

    setTimeout(() => {
      this.indicatorService.checkAllActiveEmaAlerts().catch((err) => {
        this.logger.error(`Lỗi khởi chạy EMA Cross Monitor ban đầu: ${err.message}`);
      });
    }, 6000);
  }

  onModuleDestroy() {
    if (this.macroTimeoutId) {
      clearTimeout(this.macroTimeoutId);
      this.macroTimeoutId = null;
    }
    if (this.goldIntervalId) {
      clearInterval(this.goldIntervalId);
      this.goldIntervalId = null;
    }
    if (this.priceAlertIntervalId) {
      clearInterval(this.priceAlertIntervalId);
      this.priceAlertIntervalId = null;
    }
    if (this.emaAlertIntervalId) {
      clearInterval(this.emaAlertIntervalId);
      this.emaAlertIntervalId = null;
    }
    this.logger.log('🛑 Cron service đã hủy tất cả background timers an toàn.');
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

