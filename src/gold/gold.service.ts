import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import {
  XauOverview,
  XauTimeframe,
  XauTimeframeDetail,
  XauAlertTrigger,
  UserXauSettings,
  RsiZone,
} from './gold.interface';

@Injectable()
export class GoldService {
  private readonly logger = new Logger(GoldService.name);

  // Cache dữ liệu tổng quan XAU/USD (5 giây)
  private cachedOverview: XauOverview | null = null;
  private lastFetchTime = 0;

  // Quản lý trạng thái vùng RSI của từng khung thời gian để chống spam
  private readonly timeframeStateMap = new Map<
    XauTimeframe,
    {
      lastState: 'OVERBOUGHT' | 'OVERSOLD' | 'NORMAL';
      lastRsi: number;
      lastAlertTime: number;
    }
  >();

  // Danh sách các khung thời gian hỗ trợ
  readonly supportedTimeframes: XauTimeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  readonly timeframeLabels: Record<XauTimeframe, string> = {
    M1: '1 Phút (M1)',
    M5: '5 Phút (M5)',
    M15: '15 Phút (M15)',
    M30: '30 Phút (M30)',
    H1: '1 Giờ (H1)',
    H4: '4 Giờ (H4)',
    D1: '1 Ngày (D1)',
  };

  constructor(private readonly prisma: PrismaService) {
    // Khởi tạo state ban đầu cho các khung
    this.supportedTimeframes.forEach((tf) => {
      this.timeframeStateMap.set(tf, {
        lastState: 'NORMAL',
        lastRsi: 50,
        lastAlertTime: 0,
      });
    });

    this.loadHistoricalAlerts().catch((err) => {
      this.logger.warn(`Chưa thể nạp lịch sử XAU alert: ${err.message}`);
    });
  }

  /**
   * Nạp lịch sử các cảnh báo gần nhất để khôi phục trạng thái sau khi restart
   */
  private async loadHistoricalAlerts() {
    try {
      const recentLogs = await this.prisma.xauAlertLog.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
      });

      recentLogs.forEach((log) => {
        const tf = log.timeframe as XauTimeframe;
        if (this.supportedTimeframes.includes(tf)) {
          const current = this.timeframeStateMap.get(tf);
          if (current && current.lastAlertTime < log.createdAt.getTime()) {
            current.lastState = log.alertType as 'OVERBOUGHT' | 'OVERSOLD';
            current.lastRsi = log.rsi;
            current.lastAlertTime = log.createdAt.getTime();
          }
        }
      });
    } catch (e: any) {
      this.logger.warn(`Lỗi nạp historical XAU logs: ${e.message}`);
    }
  }

  /**
   * Lấy dữ liệu tổng quan giá Vàng XAU/USD & RSI đa khung thời gian
   */
  async getXauOverview(forceFresh = false): Promise<XauOverview> {
    const now = Date.now();
    if (!forceFresh && this.cachedOverview && now - this.lastFetchTime < 5000) {
      return this.cachedOverview;
    }

    try {
      const overview = await this.fetchFromTradingView();
      this.cachedOverview = overview;
      this.lastFetchTime = now;
      return overview;
    } catch (err: any) {
      this.logger.warn(`TradingView fetch thất bại: ${err.message}. Đang chuyển sang Binance fallback...`);
      try {
        const overview = await this.fetchFromBinanceFallback();
        this.cachedOverview = overview;
        this.lastFetchTime = now;
        return overview;
      } catch (fallbackErr: any) {
        this.logger.error(`Binance fallback cũng thất bại: ${fallbackErr.message}`);
        if (this.cachedOverview) return this.cachedOverview;
        throw new Error(`Không thể lấy dữ liệu giá Vàng: ${fallbackErr.message}`);
      }
    }
  }

  /**
   * 1. Nguồn chính: TradingView Scanner API (OANDA:XAUUSD & TVC:GOLD)
   */
  private async fetchFromTradingView(): Promise<XauOverview> {
    const url = 'https://scanner.tradingview.com/cfd/scan';
    const payload = {
      symbols: {
        tickers: ['OANDA:XAUUSD', 'TVC:GOLD', 'FX_IDC:XAUUSD'],
      },
      columns: [
        'close',
        'open',
        'high',
        'low',
        'change',
        'change_abs',
        'RSI|1',
        'RSI|5',
        'RSI|15',
        'RSI|30',
        'RSI|60',
        'RSI|240',
        'RSI',
      ],
    };

    const res = await axios.post(url, payload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      timeout: 6000,
    });

    if (!res.data || !Array.isArray(res.data.data) || res.data.data.length === 0) {
      throw new Error('Dữ liệu TradingView rỗng');
    }

    const row = res.data.data[0];
    const d = row.d;

    const price = Number(d[0]) || 0;
    const open = Number(d[1]) || price;
    const high = Number(d[2]) || price;
    const low = Number(d[3]) || price;
    const changePercent = Number(d[4]) || 0;
    const change = Number(d[5]) || (price - open);

    const rsi1 = Number(d[6]) || 50;
    const rsi5 = Number(d[7]) || 50;
    const rsi15 = Number(d[8]) || 50;
    const rsi30 = Number(d[9]) || 50;
    const rsi60 = Number(d[10]) || 50;
    const rsi240 = Number(d[11]) || 50;
    const rsiDay = Number(d[12]) || 50;

    const rawRsiMap: Record<XauTimeframe, number> = {
      M1: Number(rsi1.toFixed(1)),
      M5: Number(rsi5.toFixed(1)),
      M15: Number(rsi15.toFixed(1)),
      M30: Number(rsi30.toFixed(1)),
      H1: Number(rsi60.toFixed(1)),
      H4: Number(rsi240.toFixed(1)),
      D1: Number(rsiDay.toFixed(1)),
    };

    const timeframes = {} as Record<XauTimeframe, XauTimeframeDetail>;

    for (const tf of this.supportedTimeframes) {
      const rsi = rawRsiMap[tf];
      const { zone, statusText, badge } = this.determineRsiZone(rsi);
      timeframes[tf] = {
        timeframe: tf,
        label: this.timeframeLabels[tf],
        rsi,
        zone,
        statusText,
        badge,
      };
    }

    return {
      price: Number(price.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      high24h: Number(high.toFixed(2)),
      low24h: Number(low.toFixed(2)),
      timeframes,
      updatedAt: new Date(),
      source: 'TradingView (OANDA Spot Gold)',
    };
  }

  /**
   * 2. Nguồn dự phòng: Binance PAXGUSDT (PAX Gold 1:1 Ounce Gold)
   */
  private async fetchFromBinanceFallback(): Promise<XauOverview> {
    const tickerRes = await axios.get('https://api.binance.com/api/v3/ticker/24hr?symbol=PAXGUSDT', {
      timeout: 5000,
    });

    const ticker = tickerRes.data;
    const price = parseFloat(ticker.lastPrice);
    const change = parseFloat(ticker.priceChange);
    const changePercent = parseFloat(ticker.priceChangePercent);
    const high = parseFloat(ticker.highPrice);
    const low = parseFloat(ticker.lowPrice);

    // Tính RSI cho từng khung thời gian từ Klines của Binance
    const binanceIntervalMap: Record<XauTimeframe, string> = {
      M1: '1m',
      M5: '5m',
      M15: '15m',
      M30: '30m',
      H1: '1h',
      H4: '4h',
      D1: '1d',
    };

    const timeframes = {} as Record<XauTimeframe, XauTimeframeDetail>;

    await Promise.all(
      this.supportedTimeframes.map(async (tf) => {
        try {
          const interval = binanceIntervalMap[tf];
          const klineRes = await axios.get(
            `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=50`,
            { timeout: 5000 },
          );
          const closes: number[] = klineRes.data.map((k: any) => parseFloat(k[4]));
          const rsiVal = this.calculateRsi(closes, 14);
          const rsi = Number(rsiVal.toFixed(1));
          const { zone, statusText, badge } = this.determineRsiZone(rsi);
          timeframes[tf] = {
            timeframe: tf,
            label: this.timeframeLabels[tf],
            rsi,
            zone,
            statusText,
            badge,
          };
        } catch (e) {
          timeframes[tf] = {
            timeframe: tf,
            label: this.timeframeLabels[tf],
            rsi: 50,
            zone: 'NORMAL',
            statusText: 'Trung tính',
            badge: '⚪',
          };
        }
      }),
    );

    return {
      price: Number(price.toFixed(2)),
      change: Number(change.toFixed(2)),
      changePercent: Number(changePercent.toFixed(2)),
      high24h: Number(high.toFixed(2)),
      low24h: Number(low.toFixed(2)),
      timeframes,
      updatedAt: new Date(),
      source: 'Binance (PAX Gold / XAU)',
    };
  }

  /**
   * Tính toán chỉ số RSI-14 (Wilder Smoothed)
   */
  private calculateRsi(closes: number[], period = 14): number {
    if (closes.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.abs(diff)) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  /**
   * Xác định trạng thái vùng RSI và nhãn trực quan
   */
  determineRsiZone(rsi: number, overbought = 70, oversold = 30): {
    zone: RsiZone;
    statusText: string;
    badge: string;
  } {
    if (rsi >= 80) {
      return {
        zone: 'EXTREME_OVERBOUGHT',
        statusText: 'CỰC KỲ QUÁ MUA (Đỉnh rủi ro)',
        badge: '🔴🔴',
      };
    }
    if (rsi >= overbought) {
      return {
        zone: 'OVERBOUGHT',
        statusText: 'QUÁ MUA (Overbought)',
        badge: '🔴',
      };
    }
    if (rsi <= 20) {
      return {
        zone: 'EXTREME_OVERSOLD',
        statusText: 'CỰC KỲ QUÁ BÁN (Đáy tiềm năng)',
        badge: '🟢🟢',
      };
    }
    if (rsi <= oversold) {
      return {
        zone: 'OVERSOLD',
        statusText: 'QUÁ BÁN (Oversold)',
        badge: '🟢',
      };
    }
    return {
      zone: 'NORMAL',
      statusText: 'Trung tính',
      badge: '⚪',
    };
  }

  /**
   * Kiểm tra xem các khung thời gian có kích hoạt tín hiệu Quá Mua / Quá Bán mới hay không
   */
  async checkAlertTriggers(): Promise<XauAlertTrigger[]> {
    const overview = await this.getXauOverview();
    const triggers: XauAlertTrigger[] = [];
    const now = Date.now();

    for (const tf of this.supportedTimeframes) {
      const detail = overview.timeframes[tf];
      if (!detail) continue;

      const rsi = detail.rsi;
      const stateObj = this.timeframeStateMap.get(tf) || {
        lastState: 'NORMAL',
        lastRsi: 50,
        lastAlertTime: 0,
      };

      // 1. Tín hiệu QUÁ MUA (RSI >= 70)
      if (rsi >= 70) {
        const isNewTrigger = stateObj.lastState !== 'OVERBOUGHT';
        // Hoặc trường hợp đặc biệt: Cực kỳ quá mua >= 80 và đã qua hơn 30 phút kể từ lần báo trước
        const isExtremeReminder = rsi >= 80 && now - stateObj.lastAlertTime > 1800000;

        if (isNewTrigger || isExtremeReminder) {
          stateObj.lastState = 'OVERBOUGHT';
          stateObj.lastRsi = rsi;
          stateObj.lastAlertTime = now;
          this.timeframeStateMap.set(tf, stateObj);

          const isExtreme = rsi >= 80;
          triggers.push({
            timeframe: tf,
            timeframeLabel: this.timeframeLabels[tf],
            price: overview.price,
            rsi,
            alertType: 'OVERBOUGHT',
            level: isExtreme ? 'EXTREME_ZONE' : 'NORMAL_ZONE',
            message: `XAU/USD đã tiến vào vùng ${isExtreme ? 'CỰC KỲ QUÁ MUA (RSI >= 80)' : 'QUÁ MUA (RSI >= 70)'} trên khung ${this.timeframeLabels[tf]}.`,
            actionAdvice: isExtreme
              ? '⚠️ Áp lực chốt lời rất mạnh! Rủi ro đảo chiều giảm sâu cao. Hạn chế tối đa việc mở vị thế BUY đuổi giá, cân nhắc chốt lời hoặc canh tín hiệu SELL phân kỳ ngắn hạn.'
              : '⚠️ Lực mua đang hưng phấn quá mức. Cân nhắc dời Stoploss bảo toàn lợi nhuận hoặc hạ bớt tỷ trọng lệnh BUY ngắn hạn.',
          });

          // Lưu log vào database
          this.saveAlertLog(tf, rsi, overview.price, 'OVERBOUGHT', `Khung ${tf} - RSI ${rsi}`).catch(() => {});
        }
      }
      // 2. Tín hiệu QUÁ BÁN (RSI <= 30)
      else if (rsi <= 30) {
        const isNewTrigger = stateObj.lastState !== 'OVERSOLD';
        const isExtremeReminder = rsi <= 20 && now - stateObj.lastAlertTime > 1800000;

        if (isNewTrigger || isExtremeReminder) {
          stateObj.lastState = 'OVERSOLD';
          stateObj.lastRsi = rsi;
          stateObj.lastAlertTime = now;
          this.timeframeStateMap.set(tf, stateObj);

          const isExtreme = rsi <= 20;
          triggers.push({
            timeframe: tf,
            timeframeLabel: this.timeframeLabels[tf],
            price: overview.price,
            rsi,
            alertType: 'OVERSOLD',
            level: isExtreme ? 'EXTREME_ZONE' : 'NORMAL_ZONE',
            message: `XAU/USD đã giảm sâu vào vùng ${isExtreme ? 'CỰC KỲ QUÁ BÁN (RSI <= 20)' : 'QUÁ BÁN (RSI <= 30)'} trên khung ${this.timeframeLabels[tf]}.`,
            actionAdvice: isExtreme
              ? '💡 Áp lực bán đã cạn kiệt cực độ! Tỷ lệ xuất hiện nhịp hồi phục kỹ thuật (Short Squeeze / Rebound) rất cao. Tránh SELL đuổi đáy, quan sát tín hiệu đảo chiều nến để canh BUY bắt nhịp hồi.'
              : '💡 Đà giảm đang đi vào vùng quá tải. Có thể chuẩn bị kế hoạch canh gom BUY khi xuất hiện nến đảo chiều hỗ trợ.',
          });

          this.saveAlertLog(tf, rsi, overview.price, 'OVERSOLD', `Khung ${tf} - RSI ${rsi}`).catch(() => {});
        }
      }
      // 3. Phục hồi về vùng trung tính (35 - 65) -> Reset trạng thái để chuẩn bị cho chu kỳ cảnh báo tiếp theo
      else if (rsi >= 35 && rsi <= 65) {
        if (stateObj.lastState !== 'NORMAL') {
          stateObj.lastState = 'NORMAL';
          stateObj.lastRsi = rsi;
          this.timeframeStateMap.set(tf, stateObj);
        }
      }
    }

    return triggers;
  }

  /**
   * Lưu log cảnh báo vào database
   */
  private async saveAlertLog(
    timeframe: string,
    rsi: number,
    price: number,
    alertType: string,
    message: string,
  ) {
    try {
      await this.prisma.executeWithRetry(() =>
        this.prisma.xauAlertLog.create({
          data: {
            timeframe,
            rsi,
            price,
            alertType,
            message,
          },
        }),
      );
    } catch (e: any) {
      this.logger.warn(`Lỗi lưu XauAlertLog: ${e.message}`);
    }
  }

  /**
   * Lấy cấu hình cảnh báo XAU/USD của người dùng
   */
  async getUserSettings(chatId: string): Promise<UserXauSettings> {
    try {
      const user = await this.prisma.executeWithRetry(() =>
        this.prisma.telegramUser.findUnique({
          where: { chatId },
          select: {
            xauAlertEnabled: true,
            xauAlertTimeframes: true,
            xauOverboughtRsi: true,
            xauOversoldRsi: true,
          },
        }),
      );

      if (user) {
        return {
          enabled: user.xauAlertEnabled,
          timeframes: (user.xauAlertTimeframes as XauTimeframe[]) || ['M15', 'M30', 'H1', 'H4', 'D1'],
          overboughtRsi: user.xauOverboughtRsi || 70,
          oversoldRsi: user.xauOversoldRsi || 30,
        };
      }
    } catch (e: any) {
      this.logger.warn(`Lỗi lấy XAU settings của user ${chatId}: ${e.message}`);
    }

    return {
      enabled: true,
      timeframes: ['M15', 'M30', 'H1', 'H4', 'D1'],
      overboughtRsi: 70,
      oversoldRsi: 30,
    };
  }

  /**
   * Cập nhật toàn bộ cấu hình XAU của người dùng
   */
  async updateUserSettings(chatId: string, settings: Partial<UserXauSettings>): Promise<UserXauSettings> {
    const current = await this.getUserSettings(chatId);
    const updated: UserXauSettings = {
      ...current,
      ...settings,
    };

    await this.prisma.executeWithRetry(() =>
      this.prisma.telegramUser.upsert({
        where: { chatId },
        update: {
          xauAlertEnabled: updated.enabled,
          xauAlertTimeframes: updated.timeframes,
          xauOverboughtRsi: updated.overboughtRsi,
          xauOversoldRsi: updated.oversoldRsi,
        },
        create: {
          chatId,
          xauAlertEnabled: updated.enabled,
          xauAlertTimeframes: updated.timeframes,
          xauOverboughtRsi: updated.overboughtRsi,
          xauOversoldRsi: updated.oversoldRsi,
        },
      }),
    );

    return updated;
  }

  /**
   * Bật/Tắt một khung thời gian cụ thể của người dùng
   */
  async toggleTimeframe(chatId: string, tf: XauTimeframe): Promise<UserXauSettings> {
    const current = await this.getUserSettings(chatId);
    let nextTfs: XauTimeframe[];

    if (current.timeframes.includes(tf)) {
      nextTfs = current.timeframes.filter((t) => t !== tf);
    } else {
      nextTfs = [...current.timeframes, tf];
    }

    return this.updateUserSettings(chatId, { timeframes: nextTfs });
  }

  /**
   * Bật/Tắt tổng thể thông báo XAU
   */
  async toggleEnabled(chatId: string): Promise<UserXauSettings> {
    const current = await this.getUserSettings(chatId);
    return this.updateUserSettings(chatId, { enabled: !current.enabled });
  }

  /**
   * Đổi bộ ngưỡng RSI (70/30, 75/25, 80/20)
   */
  async setThresholdPreset(chatId: string, overbought: number, oversold: number): Promise<UserXauSettings> {
    return this.updateUserSettings(chatId, {
      overboughtRsi: overbought,
      oversoldRsi: oversold,
    });
  }

  /**
   * Lấy danh sách tất cả Users đang kích hoạt cảnh báo XAU
   */
  async getAllUsersForAlert(): Promise<Array<{ chatId: string; settings: UserXauSettings }>> {
    try {
      const users = await this.prisma.executeWithRetry(() =>
        this.prisma.telegramUser.findMany({
          where: { xauAlertEnabled: true },
          select: {
            chatId: true,
            xauAlertEnabled: true,
            xauAlertTimeframes: true,
            xauOverboughtRsi: true,
            xauOversoldRsi: true,
          },
        }),
      );

      return users.map((u) => ({
        chatId: u.chatId,
        settings: {
          enabled: u.xauAlertEnabled,
          timeframes: (u.xauAlertTimeframes as XauTimeframe[]) || ['M15', 'M30', 'H1', 'H4', 'D1'],
          overboughtRsi: u.xauOverboughtRsi || 70,
          oversoldRsi: u.xauOversoldRsi || 30,
        },
      }));
    } catch (e: any) {
      this.logger.error(`Lỗi lấy danh sách users cảnh báo XAU: ${e.message}`);
      return [];
    }
  }

  /**
   * Render thanh biểu thị Gauge cho RSI (Ví dụ: [██████░░░░] 60.5)
   */
  renderRsiGauge(rsi: number): string {
    const totalBars = 10;
    const filledBars = Math.round((Math.max(0, Math.min(100, rsi)) / 100) * totalBars);
    const emptyBars = totalBars - filledBars;
    return `[${'█'.repeat(filledBars)}${'░'.repeat(emptyBars)}]`;
  }

  /**
   * Format tin nhắn bảng tổng hợp RSI XAU/USD hiển thị trên Telegram
   */
  renderOverviewMessage(data: XauOverview): string {
    const icon = data.change > 0 ? '🟢' : data.change < 0 ? '🔴' : '🟡';
    const sign = data.change > 0 ? '+' : '';

    const timeStr = data.updatedAt.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let msg = `🟡 <b>GIÁ VÀNG XAU/USD & BẢNG RSI ĐA KHUNG THỜI GIAN</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💰 <b>Giá hiện tại:</b> <code>$${data.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</code>\n`;
    msg += `${icon} <b>Biến động 24h:</b> <b>${sign}$${data.change} (${sign}${data.changePercent}%)</b>\n`;
    if (data.high24h && data.low24h) {
      msg += `📈 <b>Cao nhất:</b> <code>$${data.high24h}</code> | 📉 <b>Thấp nhất:</b> <code>$${data.low24h}</code>\n`;
    }
    msg += `🕒 <i>Cập nhật: ${timeStr} (Nguồn: ${data.source})</i>\n\n`;

    msg += `📊 <b>CHỈ SỐ RSI(14) CÁC KHUNG THỜI GIAN:</b>\n`;

    for (const tf of this.supportedTimeframes) {
      const item = data.timeframes[tf];
      if (!item) continue;
      const gauge = this.renderRsiGauge(item.rsi);
      msg += `• <b>${item.label}:</b> <code>${item.rsi.toFixed(1).padStart(4, ' ')}</code> ${gauge} ${item.badge} <i>${item.statusText}</i>\n`;
    }

    msg += `\n💡 <b>Quy ước vùng RSI:</b>\n`;
    msg += `🔴 <b>>= 70:</b> Quá mua (Overbought) - Cẩn trọng đảo chiều giảm\n`;
    msg += `🟢 <b><= 30:</b> Quá bán (Oversold) - Cơ hội hồi phục tăng\n`;
    msg += `⚪ <b>30 - 70:</b> Vùng trung tính dao động`;

    return msg;
  }

  /**
   * Format tin nhắn cảnh báo khi RSI vào vùng Quá Mua / Quá Bán
   */
  renderAlertMessage(trigger: XauAlertTrigger): string {
    const isOverbought = trigger.alertType === 'OVERBOUGHT';
    const isExtreme = trigger.level === 'EXTREME_ZONE';

    const headerEmoji = isOverbought ? (isExtreme ? '🚨🔴🔴' : '🔔🔴') : (isExtreme ? '🚨🟢🟢' : '🔔🟢');
    const headerTitle = isOverbought
      ? (isExtreme ? 'CẢNH BÁO XAU/USD: CỰC KỲ QUÁ MUA (EXTREME)' : 'CẢNH BÁO XAU/USD: VÀO VÙNG QUÁ MUA (OVERBOUGHT)')
      : (isExtreme ? 'CẢNH BÁO XAU/USD: CỰC KỲ QUÁ BÁN (EXTREME)' : 'CẢNH BÁO XAU/USD: VÀO VÙNG QUÁ BÁN (OVERSOLD)');

    const gauge = this.renderRsiGauge(trigger.rsi);

    let msg = `${headerEmoji} <b>${headerTitle}</b>\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `⏳ <b>Khung thời gian:</b> <b>${trigger.timeframeLabel}</b>\n`;
    msg += `💰 <b>Giá Vàng hiện tại:</b> <code>$${trigger.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</code>\n`;
    msg += `📈 <b>Chỉ số RSI (14):</b> <code>${trigger.rsi.toFixed(1)}</code> ${gauge}\n`;
    msg += `🎯 <b>Trạng thái:</b> <b>${isOverbought ? 'Quá Mua (Áp lực điều chỉnh)' : 'Quá Bán (Áp lực hồi phục)'}</b>\n\n`;

    msg += `📝 <b>Chi tiết phân tích:</b>\n`;
    msg += `👉 ${trigger.message}\n\n`;

    msg += `💡 <b>Khuyến nghị hành động:</b>\n`;
    msg += `<i>${trigger.actionAdvice}</i>\n`;

    return msg;
  }
}
