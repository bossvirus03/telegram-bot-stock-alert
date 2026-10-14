import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  EmaTimeframe,
  EmaCrossType,
  EmaPreset,
  EmaIndicatorState,
  EmaAlertItem,
  CreateEmaAlertDto,
  CreateEmaAlertResult,
  ActiveEmaAlertDetail,
} from './indicator.interface';

@Injectable()
export class IndicatorService {
  private readonly logger = new Logger(IndicatorService.name);

  // Cache dữ liệu nến klines ngắn hạn (6 giây) để tối ưu hiệu năng
  private readonly klinesCache = new Map<string, { closes: number[]; price: number; time: number }>();

  // Danh sách alias cho Vàng
  private readonly goldAliases = new Set([
    'XAU',
    'GOLD',
    'XAUUSD',
    'VANG',
    'VANGTHEGIOI',
    'XAU/USD',
  ]);

  readonly supportedTimeframes: EmaTimeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

  readonly binanceIntervalMap: Record<EmaTimeframe, string> = {
    M1: '1m',
    M5: '5m',
    M15: '15m',
    M30: '30m',
    H1: '1h',
    H4: '4h',
    D1: '1d',
  };

  readonly timeframeLabels: Record<EmaTimeframe, string> = {
    M1: '1 Phút (M1)',
    M5: '5 Phút (M5)',
    M15: '15 Phút (M15)',
    M30: '30 Phút (M30)',
    H1: '1 Giờ (H1)',
    H4: '4 Giờ (H4)',
    D1: '1 Ngày (D1)',
  };

  readonly presets: EmaPreset[] = [
    { id: '9_21', name: 'EMA 9 / 21', fast: 9, slow: 21, description: 'Lướt sóng / Ngắn hạn (Scalping)' },
    { id: '20_50', name: 'EMA 20 / 50', fast: 20, slow: 50, description: 'Bắt sóng xu hướng (Swing)' },
    { id: '50_200', name: 'EMA 50 / 200', fast: 50, slow: 200, description: 'Golden / Death Cross (Dài hạn)' },
    { id: '34_89', name: 'EMA 34 / 89', fast: 34, slow: 89, description: 'Hệ thống Fibonacci' },
    { id: '12_26', name: 'EMA 12 / 26', fast: 12, slow: 26, description: 'Cốt lõi tín hiệu MACD' },
  ];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  /**
   * Chuẩn hóa mã khung thời gian từ chuỗi người dùng nhập (vd: 15m -> M15, 1h -> H1, d -> D1)
   */
  normalizeTimeframe(input: string): EmaTimeframe | null {
    if (!input) return null;
    const clean = input.trim().toUpperCase();

    if (this.supportedTimeframes.includes(clean as EmaTimeframe)) {
      return clean as EmaTimeframe;
    }

    const mapping: Record<string, EmaTimeframe> = {
      '1': 'M1',
      '1M': 'M1',
      'M1': 'M1',
      '5': 'M5',
      '5M': 'M5',
      'M5': 'M5',
      '15': 'M15',
      '15M': 'M15',
      'M15': 'M15',
      '30': 'M30',
      '30M': 'M30',
      'M30': 'M30',
      '60': 'H1',
      '60M': 'H1',
      '1H': 'H1',
      'H1': 'H1',
      '4H': 'H4',
      '240': 'H4',
      'H4': 'H4',
      '1D': 'D1',
      'D': 'D1',
      'D1': 'D1',
      'DAY': 'D1',
      'NGAY': 'D1',
    };

    return mapping[clean] || null;
  }

  /**
   * Thuật toán tính đường Exponential Moving Average (EMA)
   * Sử dụng SMA cho chu kỳ ban đầu để dữ liệu mượt và chuẩn xác nhất
   */
  calculateEma(closes: number[], period: number): number[] {
    if (!closes || closes.length < period || period <= 0) {
      return [];
    }

    const k = 2 / (period + 1);
    const ema: number[] = new Array(closes.length).fill(0);

    // 1. Khởi tạo giá trị đầu tiên bằng SMA của `period` phần tử đầu
    let sum = 0;
    for (let i = 0; i < period; i++) {
      sum += closes[i];
    }
    ema[period - 1] = sum / period;

    // 2. Tính EMA cho các nến tiếp theo
    for (let i = period; i < closes.length; i++) {
      ema[i] = closes[i] * k + ema[i - 1] * (1 - k);
    }

    return ema;
  }

  /**
   * Lấy chuỗi giá đóng cửa (closes) từ API tương ứng
   */
  async fetchCloses(
    rawSymbol: string,
    timeframe: EmaTimeframe,
    limit = 250,
  ): Promise<{ closes: number[]; currentPrice: number; displaySymbol: string; assetType: 'GOLD' | 'CRYPTO' }> {
    const symbolUpper = rawSymbol.trim().toUpperCase().replace('/', '');
    const cacheKey = `${symbolUpper}:${timeframe}`;
    const now = Date.now();

    if (this.klinesCache.has(cacheKey)) {
      const cached = this.klinesCache.get(cacheKey)!;
      if (now - cached.time < 6000) {
        let assetType: 'GOLD' | 'CRYPTO' = 'CRYPTO';
        let displaySymbol = `${symbolUpper}/USDT`;
        if (this.goldAliases.has(symbolUpper)) {
          assetType = 'GOLD';
          displaySymbol = 'XAU/USD (Vàng)';
        }
        return {
          closes: cached.closes,
          currentPrice: cached.price,
          displaySymbol,
          assetType,
        };
      }
    }

    // 1. Kiểm tra VÀNG (XAU/USD) - dùng PAXGUSDT trên Binance spot
    if (this.goldAliases.has(symbolUpper)) {
      const interval = this.binanceIntervalMap[timeframe] || '15m';
      try {
        const res = await axios.get(
          `https://api.binance.com/api/v3/klines?symbol=PAXGUSDT&interval=${interval}&limit=${limit}`,
          { timeout: 6000 },
        );
        if (Array.isArray(res.data) && res.data.length > 0) {
          const closes: number[] = res.data.map((k: any) => parseFloat(k[4]));
          const currentPrice = closes[closes.length - 1];
          this.klinesCache.set(cacheKey, { closes, price: currentPrice, time: now });
          return {
            closes,
            currentPrice,
            displaySymbol: 'XAU/USD (Vàng)',
            assetType: 'GOLD',
          };
        }
      } catch (err: any) {
        this.logger.error(`Lỗi tải nến Vàng: ${err.message}`);
        throw new Error(`Không thể lấy nến cho Vàng (XAU/USD): ${err.message}`);
      }
    }

    // 2. Kiểm tra CRYPTO trên Binance
    const cryptoPair = symbolUpper.endsWith('USDT') ? symbolUpper : `${symbolUpper}USDT`;
    const cleanCrypto = symbolUpper.replace(/USDT$/, '');
    const interval = this.binanceIntervalMap[timeframe] || '15m';

    try {
      const res = await axios.get(
        `https://api.binance.com/api/v3/klines?symbol=${cryptoPair}&interval=${interval}&limit=${limit}`,
        { timeout: 5000 },
      );
      if (Array.isArray(res.data) && res.data.length > 0) {
        const closes: number[] = res.data.map((k: any) => parseFloat(k[4]));
        const currentPrice = closes[closes.length - 1];
        this.klinesCache.set(cacheKey, { closes, price: currentPrice, time: now });
        return {
          closes,
          currentPrice,
          displaySymbol: `${cleanCrypto}/USDT`,
          assetType: 'CRYPTO',
        };
      }
    } catch (cryptoErr) {
      // Không tìm thấy trên Binance
    }

    throw new Error(
      `Không tìm thấy dữ liệu cho mã <b>"${rawSymbol}"</b>.\n` +
      `💡 Hỗ trợ:\n` +
      `• Vàng: <code>XAU</code>, <code>GOLD</code>\n` +
      `• Crypto: <code>BTC</code>, <code>ETH</code>, <code>SOL</code>, <code>BNB</code>, <code>DOGE</code>...`,
    );
  }

  /**
   * Tính toán trạng thái EMA và phát hiện tín hiệu giao cắt cho 1 mã & 1 khung thời gian
   */
  async getEmaState(
    symbol: string,
    timeframe: EmaTimeframe,
    fastPeriod: number,
    slowPeriod: number,
  ): Promise<EmaIndicatorState> {
    if (fastPeriod >= slowPeriod) {
      throw new Error(`Chu kỳ EMA nhanh (${fastPeriod}) phải nhỏ hơn chu kỳ EMA chậm (${slowPeriod}).`);
    }

    const needCount = Math.max(slowPeriod + 30, 80);
    const { closes, currentPrice, displaySymbol, assetType } = await this.fetchCloses(
      symbol,
      timeframe,
      needCount,
    );

    if (closes.length < slowPeriod + 2) {
      throw new Error(
        `Số lượng nến (${closes.length}) không đủ để tính toán EMA ${slowPeriod} (cần ít nhất ${slowPeriod + 2} nến).`,
      );
    }

    const emaFast = this.calculateEma(closes, fastPeriod);
    const emaSlow = this.calculateEma(closes, slowPeriod);

    const len = closes.length;
    const currFast = emaFast[len - 1];
    const currSlow = emaSlow[len - 1];
    const prevFast = emaFast[len - 2];
    const prevSlow = emaSlow[len - 2];

    // Phát hiện giao cắt
    let crossDetected: EmaCrossType | null = null;
    if (prevFast <= prevSlow && currFast > currSlow) {
      crossDetected = 'BULLISH'; // Golden Cross / Fast cắt lên Slow
    } else if (prevFast >= prevSlow && currFast < currSlow) {
      crossDetected = 'BEARISH'; // Death Cross / Fast cắt xuống Slow
    }

    const diffPercent = Number((((currFast - currSlow) / currSlow) * 100).toFixed(3));
    const trend: 'BULLISH' | 'BEARISH' = currFast >= currSlow ? 'BULLISH' : 'BEARISH';

    return {
      symbol: symbol.toUpperCase(),
      displaySymbol,
      assetType,
      timeframe,
      fastPeriod,
      slowPeriod,
      currentPrice: Number(currentPrice.toFixed(4)),
      fastValue: Number(currFast.toFixed(4)),
      slowValue: Number(currSlow.toFixed(4)),
      prevFastValue: Number(prevFast.toFixed(4)),
      prevSlowValue: Number(prevSlow.toFixed(4)),
      diffPercent,
      trend,
      crossDetected,
      updatedAt: new Date(),
    };
  }

  /**
   * Tạo cảnh báo EMA Cross mới cho người dùng
   */
  async createEmaAlert(dto: CreateEmaAlertDto): Promise<CreateEmaAlertResult> {
    try {
      const { chatId, username, symbol, timeframe, fastPeriod, slowPeriod } = dto;

      if (!this.supportedTimeframes.includes(timeframe)) {
        return {
          success: false,
          message: `⚠️ Khung thời gian <b>${timeframe}</b> không hợp lệ. Hỗ trợ: ${this.supportedTimeframes.join(', ')}`,
        };
      }

      if (fastPeriod >= slowPeriod) {
        return {
          success: false,
          message: `⚠️ Chu kỳ EMA nhanh (<code>${fastPeriod}</code>) phải nhỏ hơn EMA chậm (<code>${slowPeriod}</code>). Ví dụ: 9 và 21, hoặc 20 và 50.`,
        };
      }

      // Kiểm tra trạng thái hiện tại
      const state = await this.getEmaState(symbol, timeframe, fastPeriod, slowPeriod);

      // Kiểm tra xem đã tồn tại cảnh báo tương tự chưa
      const existing = await this.prisma.emaAlert.findFirst({
        where: {
          chatId,
          symbol: state.symbol,
          timeframe,
          fastPeriod,
          slowPeriod,
          status: 'ACTIVE',
        },
      });

      if (existing) {
        return {
          success: false,
          message: `⚠️ Bạn đã có cảnh báo <b>EMA ${fastPeriod}/${slowPeriod}</b> cho <b>${state.displaySymbol}</b> trên khung <b>${this.timeframeLabels[timeframe]}</b> đang hoạt động rồi! (Mã #${existing.id})`,
        };
      }

      // Lưu vào database với lastCrossType là xu hướng hiện tại để chỉ báo khi có crossover MỚI
      const alert = await this.prisma.emaAlert.create({
        data: {
          chatId,
          username,
          symbol: state.symbol,
          displaySymbol: state.displaySymbol,
          assetType: state.assetType,
          timeframe,
          fastPeriod,
          slowPeriod,
          lastCrossType: state.trend, // Đặt là trend hiện tại để chỉ trigger khi đảo chiều giao cắt
          lastCrossPrice: state.currentPrice,
          status: 'ACTIVE',
        },
      });

      const trendText =
        state.trend === 'BULLISH'
          ? `🟢 <b>EMA ${fastPeriod}</b> đang NẰM TRÊN <b>EMA ${slowPeriod}</b> (+${state.diffPercent}%)`
          : `🔴 <b>EMA ${fastPeriod}</b> đang NẰM DƯỚI <b>EMA ${slowPeriod}</b> (${state.diffPercent}%)`;

      const successMessage = `
✅ <b>ĐÃ CÀI ĐẶT CẢNH BÁO EMA CROSS THÀNH CÔNG!</b> 🎯

💎 <b>Tài sản:</b> <code>${state.displaySymbol}</code>
⏳ <b>Khung thời gian:</b> <b>${this.timeframeLabels[timeframe]}</b>
📈 <b>Cặp chỉ báo:</b> <b>EMA ${fastPeriod}</b> & <b>EMA ${slowPeriod}</b>
💵 <b>Giá thị trường hiện tại:</b> <code>${this.formatPrice(state.currentPrice, state.assetType)}</code>

📊 <b>Hiện trạng:</b>
• EMA(${fastPeriod}): <code>${this.formatPrice(state.fastValue, state.assetType)}</code>
• EMA(${slowPeriod}): <code>${this.formatPrice(state.slowValue, state.assetType)}</code>
• ${trendText}

🔔 <i>Bot sẽ quét liên tục và gửi thông báo NGAY LẬP TỨC khi 2 đường EMA này cắt nhau (Golden Cross hoặc Death Cross)!</i>
      `.trim();

      return {
        success: true,
        message: successMessage,
        alert,
        state,
      };
    } catch (err: any) {
      this.logger.error(`Lỗi tạo EMA alert: ${err.message}`);
      return {
        success: false,
        message: `⚠️ Không thể tạo cảnh báo: ${err.message}`,
      };
    }
  }

  /**
   * Lấy danh sách các cảnh báo EMA đang hoạt động của User
   */
  async getUserActiveAlerts(chatId: string): Promise<ActiveEmaAlertDetail[]> {
    const alerts = await this.prisma.emaAlert.findMany({
      where: {
        chatId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: ActiveEmaAlertDetail[] = [];

    for (const alert of alerts) {
      let state: EmaIndicatorState | undefined;
      let statusText = 'Đang theo dõi';

      try {
        state = await this.getEmaState(
          alert.symbol,
          alert.timeframe as EmaTimeframe,
          alert.fastPeriod,
          alert.slowPeriod,
        );
        if (state.trend === 'BULLISH') {
          statusText = `🟢 EMA ${alert.fastPeriod} > EMA ${alert.slowPeriod} (+${state.diffPercent}%)`;
        } else {
          statusText = `🔴 EMA ${alert.fastPeriod} < EMA ${alert.slowPeriod} (${state.diffPercent}%)`;
        }
      } catch (e) {
        statusText = 'Đang chờ quét...';
      }

      results.push({
        alert,
        state,
        statusText,
      });
    }

    return results;
  }

  /**
   * Xóa một cảnh báo EMA theo ID
   */
  async deleteAlert(chatId: string, alertId: number): Promise<{ success: boolean; message: string }> {
    const alert = await this.prisma.emaAlert.findFirst({
      where: { id: alertId, chatId },
    });

    if (!alert) {
      return {
        success: false,
        message: `⚠️ Không tìm thấy cảnh báo EMA mã <code>#${alertId}</code> hoặc bạn không có quyền.`,
      };
    }

    await this.prisma.emaAlert.update({
      where: { id: alertId },
      data: { status: 'CANCELLED' },
    });

    return {
      success: true,
      message: `🗑 Đã hủy cảnh báo EMA ${alert.fastPeriod}/${alert.slowPeriod} cho <b>${alert.displaySymbol}</b> (${alert.timeframe}).`,
    };
  }

  /**
   * Xóa tất cả cảnh báo EMA của user
   */
  async clearUserAlerts(chatId: string): Promise<{ success: boolean; count: number; message: string }> {
    const res = await this.prisma.emaAlert.updateMany({
      where: { chatId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    if (res.count === 0) {
      return {
        success: true,
        count: 0,
        message: '📭 Bạn không có cảnh báo EMA nào đang hoạt động.',
      };
    }

    return {
      success: true,
      count: res.count,
      message: `🗑 Đã hủy thành công tất cả <b>${res.count}</b> cảnh báo EMA của bạn.`,
    };
  }

  /**
   * Định dạng giá theo loại tài sản
   */
  formatPrice(price: number, assetType: string): string {
    if (assetType === 'GOLD') {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (assetType === 'CRYPTO') {
      if (price >= 1000) {
        return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      } else if (price >= 1) {
        return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
      } else {
        return `$${price.toFixed(6)}`;
      }
    }
    return `${price}`;
  }

  /**
   * Vòng lặp định kỳ kiểm tra tất cả các cảnh báo EMA đang ACTIVE (gọi bởi CronService)
   */
  async checkAllActiveEmaAlerts(): Promise<number> {
    try {
      const activeAlerts = await this.prisma.emaAlert.findMany({
        where: { status: 'ACTIVE' },
      });

      if (activeAlerts.length === 0) return 0;

      // Gom nhóm theo symbol + timeframe + fastPeriod + slowPeriod để chỉ tính 1 lần
      const groupMap = new Map<string, EmaAlertItem[]>();
      for (const alert of activeAlerts) {
        const key = `${alert.symbol}:${alert.timeframe}:${alert.fastPeriod}:${alert.slowPeriod}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, []);
        }
        groupMap.get(key)!.push(alert);
      }

      let triggeredCount = 0;

      for (const [key, alerts] of groupMap.entries()) {
        const [symbol, timeframe, fastStr, slowStr] = key.split(':');
        const fast = parseInt(fastStr, 10);
        const slow = parseInt(slowStr, 10);

        try {
          const state = await this.getEmaState(symbol, timeframe as EmaTimeframe, fast, slow);

          // Nếu có tín hiệu giao cắt (BULLISH hoặc BEARISH)
          if (state.crossDetected) {
            const crossType = state.crossDetected;

            for (const alert of alerts) {
              // CHỈ kích hoạt nếu tín hiệu khác với lần giao cắt trước đó (để tránh spam)
              if (alert.lastCrossType !== crossType) {
                triggeredCount++;
                await this.handleTriggerEmaCross(alert, state, crossType);
              }
            }
          }
        } catch (calcErr: any) {
          this.logger.debug(`Không thể quét EMA cho ${key}: ${calcErr.message}`);
        }
      }

      return triggeredCount;
    } catch (err: any) {
      this.logger.error(`Lỗi trong checkAllActiveEmaAlerts: ${err.message}`);
      return 0;
    }
  }

  /**
   * Kích hoạt và gửi thông báo tín hiệu giao cắt EMA tới Telegram
   */
  private async handleTriggerEmaCross(
    alert: EmaAlertItem,
    state: EmaIndicatorState,
    crossType: EmaCrossType,
  ) {
    try {
      // 1. Cập nhật trạng thái trong Database
      await this.prisma.emaAlert.update({
        where: { id: alert.id },
        data: {
          lastCrossType: crossType,
          lastCrossPrice: state.currentPrice,
          lastTriggeredAt: new Date(),
        },
      });

      // 2. Ghi log lịch sử
      const logMessage = `${crossType} EMA(${state.fastPeriod}/${state.slowPeriod}) on ${state.symbol} [${state.timeframe}] at ${state.currentPrice}`;
      await this.prisma.emaAlertLog.create({
        data: {
          symbol: state.symbol,
          timeframe: state.timeframe,
          crossType,
          fastPeriod: state.fastPeriod,
          slowPeriod: state.slowPeriod,
          fastValue: state.fastValue,
          slowValue: state.slowValue,
          price: state.currentPrice,
          message: logMessage,
        },
      });

      // 3. Định dạng tin nhắn Telegram
      const isBullish = crossType === 'BULLISH';
      const icon = isBullish ? '🟢 🚀' : '🔴 🚨';
      const crossTitle = isBullish
        ? 'GOLDEN CROSS - TÍN HIỆU GIAO CẮT TĂNG GIÁ (MUA)!'
        : 'DEATH CROSS - TÍN HIỆU GIAO CẮT GIẢM GIÁ (BÁN)!';

      const actionText = isBullish
        ? `🟢 Đường ngắn <b>EMA ${state.fastPeriod}</b> vừa CẮT LÊN đường dài <b>EMA ${state.slowPeriod}</b>`
        : `🔴 Đường ngắn <b>EMA ${state.fastPeriod}</b> vừa CẮT XUỐNG đường dài <b>EMA ${state.slowPeriod}</b>`;

      const adviceText = isBullish
        ? '💡 <b>Khuyến nghị kỹ thuật:</b> Xác nhận xu hướng TĂNG mới. Thích hợp tìm điểm vào lệnh MUA hoặc nâng điểm dừng lỗ.'
        : '💡 <b>Khuyến nghị kỹ thuật:</b> Xác nhận xu hướng GIẢM hoặc suy yếu. Thích hợp hạ tỷ trọng, chốt lời hoặc đặt điểm phòng thủ.';

      const nowStr = new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(new Date());

      const alertMessage = `
${icon} <b>${crossTitle}</b>

💎 <b>Tài sản:</b> <code>${state.displaySymbol}</code>
⏳ <b>Khung thời gian:</b> <b>${this.timeframeLabels[state.timeframe as EmaTimeframe] || state.timeframe}</b>
⚡ <b>Hiện tượng:</b>
• ${actionText}

📊 <b>THÔNG SỐ KỸ THUẬT:</b>
• 💵 Giá khớp hiện tại: <code>${this.formatPrice(state.currentPrice, state.assetType)}</code>
• 🟢 EMA(${state.fastPeriod}): <code>${this.formatPrice(state.fastValue, state.assetType)}</code>
• 🔴 EMA(${state.slowPeriod}): <code>${this.formatPrice(state.slowValue, state.assetType)}</code>
• ⏱ Thời gian phát hiện: <code>${nowStr}</code>

${adviceText}
      `.trim();

      await this.telegramService.sendMessage(alert.chatId, alertMessage, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📋 Danh sách cảnh báo EMA', callback_data: 'ema_list' },
              { text: '➕ Đặt cảnh báo EMA mới', callback_data: 'ema_menu' },
            ],
            [
              { text: `🗑 Tắt cảnh báo này (#${alert.id})`, callback_data: `ema_del:${alert.id}` },
            ],
          ],
        },
      });

      this.logger.log(
        `🔔 [EMA ALERT TRIGGERED] ${crossType} #${alert.id} for ${alert.displaySymbol} ${alert.timeframe} (ChatId: ${alert.chatId})`,
      );
    } catch (err: any) {
      this.logger.error(`Lỗi kích hoạt EMA alert #${alert.id}: ${err.message}`);
    }
  }
}
