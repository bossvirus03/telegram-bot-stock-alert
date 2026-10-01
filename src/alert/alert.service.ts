import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { GoldService } from '../gold/gold.service';
import { StockService } from '../stock/stock.service';
import { TelegramService } from '../telegram/telegram.service';
import {
  AssetPriceInfo,
  AssetType,
  AlertCondition,
  CreateAlertResult,
  ActiveAlertDetail,
  PriceAlertItem,
} from './alert.interface';

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);

  // Cache giá ngắn hạn (3 giây) để tối ưu khi nhiều alerts cùng mã được quét cùng lúc
  private readonly priceCache = new Map<string, { info: AssetPriceInfo; time: number }>();

  // Danh sách các alias của Vàng
  private readonly goldAliases = new Set([
    'XAU',
    'GOLD',
    'XAUUSD',
    'VANG',
    'VANGTHEGIOI',
    'XAU/USD',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly goldService: GoldService,
    private readonly stockService: StockService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegramService: TelegramService,
  ) {}

  /**
   * Parse giá nhập vào từ user, hỗ trợ nhiều định dạng:
   * 4200, 4,200, 83k, 83.5k, 83000, 30.5, 30,500, 0.000015, 1.2m
   */
  parseTargetPrice(input: string | number): number | null {
    if (typeof input === 'number') {
      return isNaN(input) || input <= 0 ? null : input;
    }

    if (!input || typeof input !== 'string') return null;

    let clean = input.trim().toLowerCase();

    // Xử lý hậu tố k / m
    let multiplier = 1;
    if (clean.endsWith('k')) {
      multiplier = 1000;
      clean = clean.slice(0, -1);
    } else if (clean.endsWith('m') || clean.endsWith('tr')) {
      multiplier = 1000000;
      clean = clean.endsWith('tr') ? clean.slice(0, -2) : clean.slice(0, -1);
    }

    // Xử lý dấu phẩy / chấm phân cách
    // Nếu có cả '.' và ',' ví dụ '1,250.50' -> bỏ dấu phẩy
    if (clean.includes(',') && clean.includes('.')) {
      clean = clean.replace(/,/g, '');
    } else if (clean.includes(',')) {
      // Nếu chỉ có dấu phẩy:
      // Trường hợp '83,000' (hàng nghìn) vs '30,5' (thập phân kiểu VN)
      const parts = clean.split(',');
      if (parts.length === 2 && parts[1].length === 3 && !parts[1].includes('.')) {
        // Khả năng là phân cách hàng nghìn (ví dụ 83,000)
        clean = clean.replace(/,/g, '');
      } else {
        // Thập phân
        clean = clean.replace(',', '.');
      }
    }

    const num = parseFloat(clean);
    if (isNaN(num) || num <= 0) return null;

    return Number((num * multiplier).toFixed(8));
  }

  /**
   * Lấy giá hiện tại của bất kỳ tài sản nào (Vàng, Crypto, Cổ phiếu VN)
   */
  async fetchAssetPrice(rawSymbol: string, forceFresh = false): Promise<AssetPriceInfo> {
    const symbolUpper = rawSymbol.trim().toUpperCase().replace('/', '');
    const cacheKey = symbolUpper;
    const now = Date.now();

    if (!forceFresh && this.priceCache.has(cacheKey)) {
      const cached = this.priceCache.get(cacheKey)!;
      if (now - cached.time < 4000) {
        return cached.info;
      }
    }

    // 1. Kiểm tra VÀNG (XAU / GOLD)
    if (this.goldAliases.has(symbolUpper)) {
      try {
        const overview = await this.goldService.getXauOverview(forceFresh);
        const price = overview.price;
        const info: AssetPriceInfo = {
          symbol: 'XAU',
          displaySymbol: 'XAU/USD (Vàng)',
          assetType: 'GOLD',
          price,
          change24h: overview.changePercent,
          unit: '$',
          formattedPrice: `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          exchange: 'TradingView / OANDA',
        };
        this.priceCache.set(cacheKey, { info, time: now });
        return info;
      } catch (err: any) {
        this.logger.warn(`Lỗi lấy giá Vàng: ${err.message}`);
      }
    }

    // 2. Thử kiểm tra CRYPTO trên Binance
    const cryptoPair = symbolUpper.endsWith('USDT') ? symbolUpper : `${symbolUpper}USDT`;
    const cleanCryptoSymbol = symbolUpper.replace(/USDT$/, '');

    try {
      const binanceRes = await axios.get(
        `https://api.binance.com/api/v3/ticker/24hr?symbol=${cryptoPair}`,
        { timeout: 3500 },
      );

      if (binanceRes.data && binanceRes.data.lastPrice) {
        const price = parseFloat(binanceRes.data.lastPrice);
        const changePercent = parseFloat(binanceRes.data.priceChangePercent);
        const info: AssetPriceInfo = {
          symbol: cleanCryptoSymbol,
          displaySymbol: `${cleanCryptoSymbol}/USDT`,
          assetType: 'CRYPTO',
          price,
          change24h: changePercent,
          unit: '$',
          formattedPrice: this.formatCryptoPrice(price),
          exchange: 'Binance',
        };
        this.priceCache.set(cacheKey, { info, time: now });
        this.priceCache.set(cleanCryptoSymbol, { info, time: now });
        return info;
      }
    } catch (binanceErr: any) {
      // Không tìm thấy trên Binance hoặc lỗi mạng, tiếp tục kiểm tra Cổ phiếu VN
    }

    // 3. Kiểm tra CỔ PHIẾU VIỆT NAM (HOSE, HNX, UPCOM)
    try {
      const stockDetail = await this.stockService.getStockDetail(symbolUpper);
      if (stockDetail && stockDetail.currentPrice > 0) {
        const price = stockDetail.currentPrice; // đơn vị nghìn đồng, ví dụ: 26.5 = 26,500đ
        const info: AssetPriceInfo = {
          symbol: symbolUpper,
          displaySymbol: `${symbolUpper} (CK VN)`,
          assetType: 'STOCK',
          price,
          change24h: stockDetail.changePercent,
          unit: 'k VNĐ',
          formattedPrice: `${price.toFixed(2)}k (${(price * 1000).toLocaleString('vi-VN')}đ)`,
          exchange: 'Sàn HOSE/HNX (VPS)',
        };
        this.priceCache.set(cacheKey, { info, time: now });
        return info;
      }
    } catch (stockErr: any) {
      this.logger.warn(`Lỗi kiểm tra cổ phiếu VN ${symbolUpper}: ${stockErr.message}`);
    }

    throw new Error(
      `Không tìm thấy mã tài sản <b>"${rawSymbol}"</b>.\n` +
      `💡 Hỗ trợ:\n` +
      `• Vàng: <code>XAU</code>, <code>GOLD</code>\n` +
      `• Crypto: <code>BTC</code>, <code>ETH</code>, <code>SOL</code>, <code>BNB</code>, <code>DOGE</code>, <code>PEPE</code>...\n` +
      `• Cổ phiếu VN: <code>HPG</code>, <code>SSI</code>, <code>FPT</code>, <code>VND</code>, <code>MWG</code>...`,
    );
  }

  /**
   * Định dạng giá hiển thị cho Crypto
   */
  formatCryptoPrice(price: number): string {
    if (price >= 1000) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (price >= 1) {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    } else {
      return `$${price.toFixed(6)}`;
    }
  }

  /**
   * Chuẩn hóa giá target theo đúng đơn vị của từng loại tài sản
   */
  normalizeTargetPrice(assetType: AssetType, currentPrice: number, inputTarget: number): number {
    if (assetType === 'STOCK') {
      // Đối với cổ phiếu VN: Nếu người dùng nhập 30500 hoặc 30,500đ trong khi currentPrice ở sàn là 26.5 (nghìn đồng)
      if (inputTarget >= 1000 && currentPrice < 1000) {
        return Number((inputTarget / 1000).toFixed(2));
      }
      // Ngược lại nếu người dùng nhập 30.5
      return Number(inputTarget.toFixed(2));
    }

    if (assetType === 'GOLD') {
      return Number(inputTarget.toFixed(2));
    }

    // Crypto
    if (currentPrice < 1) {
      return Number(inputTarget.toFixed(8));
    }
    return Number(inputTarget.toFixed(4));
  }

  /**
   * Format giá hiển thị theo loại tài sản
   */
  formatPriceByAsset(price: number, assetType: string): string {
    if (assetType === 'GOLD') {
      return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (assetType === 'CRYPTO') {
      return this.formatCryptoPrice(price);
    }
    if (assetType === 'STOCK') {
      const vnd = price * 1000;
      return `${price.toFixed(2)}k (${vnd.toLocaleString('vi-VN')}đ)`;
    }
    return `${price}`;
  }

  /**
   * Tạo cảnh báo giá mới cho người dùng
   */
  async createPriceAlert(
    chatId: string,
    username: string | undefined,
    rawSymbol: string,
    rawTarget: string | number,
  ): Promise<CreateAlertResult> {
    const parsedTarget = this.parseTargetPrice(rawTarget);
    if (parsedTarget === null) {
      return {
        success: false,
        message: '⚠️ Mức giá mục tiêu không hợp lệ. Vui lòng nhập số dương. Ví dụ: <code>/alert xau 4200</code> hoặc <code>/alert btc 83000</code>',
      };
    }

    // 1. Lấy thông tin giá hiện tại của tài sản
    let priceInfo: AssetPriceInfo;
    try {
      priceInfo = await this.fetchAssetPrice(rawSymbol, true);
    } catch (err: any) {
      return {
        success: false,
        message: `❌ ${err.message}`,
      };
    }

    // 2. Chuẩn hóa target price
    const currentPrice = priceInfo.price;
    const targetPrice = this.normalizeTargetPrice(priceInfo.assetType, currentPrice, parsedTarget);

    if (targetPrice === currentPrice) {
      return {
        success: false,
        message: `⚠️ Giá hiện tại của <b>${priceInfo.displaySymbol}</b> đang là <b>${priceInfo.formattedPrice}</b>, đã bằng đúng mức giá bạn muốn đặt!`,
      };
    }

    // 3. Xác định hướng cảnh báo (Condition)
    const condition: AlertCondition = targetPrice > currentPrice ? 'ABOVE' : 'BELOW';

    // 4. Kiểm tra xem người dùng đã có cảnh báo trùng khớp đang ACTIVE không
    const existing = await this.prisma.priceAlert.findFirst({
      where: {
        chatId,
        symbol: priceInfo.symbol,
        targetPrice,
        status: 'ACTIVE',
      },
    });

    if (existing) {
      return {
        success: false,
        message: `⚠️ Bạn đã có một cảnh báo đang chờ cho <b>${priceInfo.displaySymbol}</b> ở mức giá <b>${this.formatPriceByAsset(targetPrice, priceInfo.assetType)}</b> rồi! (Mã ID: <code>#${existing.id}</code>)`,
      };
    }

    // 5. Lưu vào Database
    const alert = await this.prisma.priceAlert.create({
      data: {
        chatId,
        username: username || null,
        symbol: priceInfo.symbol,
        displaySymbol: priceInfo.displaySymbol,
        assetType: priceInfo.assetType,
        targetPrice,
        initialPrice: currentPrice,
        condition,
        status: 'ACTIVE',
      },
    });

    // 6. Tính % chênh lệch
    const diffPercent = ((targetPrice - currentPrice) / currentPrice) * 100;
    const diffText = diffPercent > 0
      ? `📈 Cần tăng thêm <b>+${diffPercent.toFixed(2)}%</b>`
      : `📉 Cần giảm xuống <b>${diffPercent.toFixed(2)}%</b>`;

    const conditionText = condition === 'ABOVE'
      ? '🚀 Vượt lên hoặc chạm mức (≥)'
      : '🔻 Giảm xuống hoặc chạm mức (≤)';

    const formattedTarget = this.formatPriceByAsset(targetPrice, priceInfo.assetType);
    const formattedInitial = this.formatPriceByAsset(currentPrice, priceInfo.assetType);

    const message = `
✅ <b>ĐÃ ĐẶT CẢNH BÁO GIÁ THÀNH CÔNG!</b> 🔔

💎 <b>Tài sản:</b> <code>${priceInfo.displaySymbol}</code> (${priceInfo.assetType})
🎯 <b>Giá đặt cảnh báo:</b> <code>${formattedTarget}</code>
💵 <b>Giá thị trường lúc đặt:</b> <code>${formattedInitial}</code>
⚖️ <b>Điều kiện kích hoạt:</b> ${conditionText}
📊 <b>Khoảng cách tới đích:</b> ${diffText}

<i>👉 Bot sẽ tự động thông báo ngay khi giá chạm hoặc vượt ngưỡng! Dùng <code>/alerts</code> để xem danh sách cảnh báo của bạn.</i>
    `.trim();

    return {
      success: true,
      message,
      alert,
      priceInfo,
    };
  }

  /**
   * Lấy danh sách cảnh báo đang ACTIVE của người dùng kèm giá realtime
   */
  async getUserActiveAlerts(chatId: string): Promise<ActiveAlertDetail[]> {
    const alerts = await this.prisma.priceAlert.findMany({
      where: {
        chatId,
        status: 'ACTIVE',
      },
      orderBy: { createdAt: 'desc' },
    });

    if (alerts.length === 0) return [];

    // Lấy giá realtime cho các symbol
    const result: ActiveAlertDetail[] = [];

    for (const alert of alerts) {
      let currentPrice = alert.initialPrice;
      try {
        const info = await this.fetchAssetPrice(alert.symbol);
        currentPrice = info.price;
      } catch (e) {}

      const diffPercent = ((alert.targetPrice - currentPrice) / currentPrice) * 100;
      let distanceText = '';
      if (alert.condition === 'ABOVE') {
        const needIncrease = ((alert.targetPrice - currentPrice) / currentPrice) * 100;
        distanceText = needIncrease <= 0 ? 'Đã chạm ngưỡng!' : `Cần tăng +${needIncrease.toFixed(2)}%`;
      } else {
        const needDecrease = ((currentPrice - alert.targetPrice) / currentPrice) * 100;
        distanceText = needDecrease <= 0 ? 'Đã chạm ngưỡng!' : `Cần giảm -${needDecrease.toFixed(2)}%`;
      }

      result.push({
        alert,
        currentPrice,
        formattedCurrentPrice: this.formatPriceByAsset(currentPrice, alert.assetType),
        formattedTargetPrice: this.formatPriceByAsset(alert.targetPrice, alert.assetType),
        formattedInitialPrice: this.formatPriceByAsset(alert.initialPrice, alert.assetType),
        diffPercent,
        distanceText,
      });
    }

    return result;
  }

  /**
   * Xóa một cảnh báo theo ID
   */
  async deleteAlert(chatId: string, alertId: number): Promise<{ success: boolean; message: string }> {
    const alert = await this.prisma.priceAlert.findFirst({
      where: {
        id: alertId,
        chatId,
      },
    });

    if (!alert) {
      return {
        success: false,
        message: `⚠️ Không tìm thấy cảnh báo mã <code>#${alertId}</code> hoặc cảnh báo này không thuộc về bạn.`,
      };
    }

    await this.prisma.priceAlert.update({
      where: { id: alertId },
      data: { status: 'CANCELLED' },
    });

    return {
      success: true,
      message: `🗑 Đã hủy cảnh báo giá cho <b>${alert.displaySymbol}</b> ở mức <b>${this.formatPriceByAsset(alert.targetPrice, alert.assetType)}</b>.`,
    };
  }

  /**
   * Hủy tất cả cảnh báo ACTIVE của user
   */
  async clearUserAlerts(chatId: string): Promise<{ success: boolean; count: number; message: string }> {
    const result = await this.prisma.priceAlert.updateMany({
      where: {
        chatId,
        status: 'ACTIVE',
      },
      data: { status: 'CANCELLED' },
    });

    if (result.count === 0) {
      return {
        success: true,
        count: 0,
        message: '📭 Bạn không có cảnh báo giá nào đang hoạt động.',
      };
    }

    return {
      success: true,
      count: result.count,
      message: `🗑 Đã hủy thành công tất cả <b>${result.count}</b> cảnh báo giá của bạn.`,
    };
  }

  /**
   * Engine kiểm tra tất cả các cảnh báo ACTIVE và kích hoạt thông báo tức thì (gọi bởi Cron)
   */
  async checkAllActiveAlerts(): Promise<number> {
    try {
      const activeAlerts = await this.prisma.priceAlert.findMany({
        where: { status: 'ACTIVE' },
      });

      if (activeAlerts.length === 0) return 0;

      // Gom nhóm theo symbol để chỉ fetch giá 1 lần duy nhất cho mỗi mã
      const symbolMap = new Map<string, PriceAlertItem[]>();
      for (const alert of activeAlerts) {
        const key = `${alert.assetType}:${alert.symbol}`;
        if (!symbolMap.has(key)) {
          symbolMap.set(key, []);
        }
        symbolMap.get(key)!.push(alert);
      }

      let triggeredCount = 0;

      // Quét từng mã
      for (const [key, alerts] of symbolMap.entries()) {
        const [assetType, symbol] = key.split(':');
        try {
          const priceInfo = await this.fetchAssetPrice(symbol, true);
          const currentPrice = priceInfo.price;

          for (const alert of alerts) {
            let isTriggered = false;

            if (alert.condition === 'ABOVE' && currentPrice >= alert.targetPrice) {
              isTriggered = true;
            } else if (alert.condition === 'BELOW' && currentPrice <= alert.targetPrice) {
              isTriggered = true;
            }

            if (isTriggered) {
              triggeredCount++;
              await this.handleTriggerAlert(alert, currentPrice, priceInfo);
            }
          }
        } catch (fetchErr: any) {
          this.logger.debug(`Không thể fetch giá cho ${key}: ${fetchErr.message}`);
        }
      }

      return triggeredCount;
    } catch (err: any) {
      this.logger.error(`Lỗi trong checkAllActiveAlerts: ${err.message}`);
      return 0;
    }
  }

  /**
   * Xử lý khi 1 alert chạm ngưỡng điều kiện
   */
  private async handleTriggerAlert(
    alert: PriceAlertItem,
    currentPrice: number,
    priceInfo: AssetPriceInfo,
  ) {
    try {
      // 1. Cập nhật trạng thái trong Database
      await this.prisma.priceAlert.update({
        where: { id: alert.id },
        data: {
          status: 'TRIGGERED',
          triggeredAt: new Date(),
          triggeredPrice: currentPrice,
        },
      });

      // 2. Định dạng tin nhắn Telegram
      const isAbove = alert.condition === 'ABOVE';
      const icon = isAbove ? '🚀' : '📉';
      const actionText = isAbove ? 'TĂNG CHẠM / VƯỢT NGƯỠNG' : 'GIẢM CHẠM / XUỐNG DƯỚI';

      const formattedCurrent = this.formatPriceByAsset(currentPrice, alert.assetType);
      const formattedTarget = this.formatPriceByAsset(alert.targetPrice, alert.assetType);
      const formattedInitial = this.formatPriceByAsset(alert.initialPrice, alert.assetType);

      const changeFromInitial = ((currentPrice - alert.initialPrice) / alert.initialPrice) * 100;
      const changeText = changeFromInitial >= 0
        ? `+${changeFromInitial.toFixed(2)}%`
        : `${changeFromInitial.toFixed(2)}%`;

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
${icon} <b>CẢNH BÁO GIÁ ĐÃ KÍCH HOẠT!</b> 🎯

💎 <b>Tài sản:</b> <code>${alert.displaySymbol}</code> (${alert.assetType})
⚡ <b>Trạng thái:</b> <b>${actionText}</b>
🎯 <b>Giá đặt cảnh báo:</b> <code>${formattedTarget}</code>
💵 <b>Giá khớp hiện tại:</b> <code>${formattedCurrent}</code>
📊 <b>Biến động:</b> <b>${changeText}</b> <i>(từ ${formattedInitial})</i>
⏱ <b>Thời gian:</b> <code>${nowStr}</code>

🔔 <i>Giá thị trường đã đạt đúng mức bạn mong đợi!</i>
      `.trim();

      // Gửi tin nhắn qua Telegram
      await this.telegramService.sendMessage(alert.chatId, alertMessage, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '➕ Đặt cảnh báo mới', callback_data: 'alert_new' },
              { text: '📋 Danh sách cảnh báo', callback_data: 'alert_refresh' },
            ],
          ],
        },
      });

      this.logger.log(
        `🔔 Đã kích hoạt alert #${alert.id} cho ${alert.displaySymbol} (ChatId: ${alert.chatId}) tại giá ${formattedCurrent}`,
      );
    } catch (err: any) {
      this.logger.error(`Lỗi kích hoạt alert #${alert.id}: ${err.message}`);
    }
  }
}
