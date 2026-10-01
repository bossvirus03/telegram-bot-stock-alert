export type AssetType = 'GOLD' | 'CRYPTO' | 'STOCK';

export type AlertCondition = 'ABOVE' | 'BELOW';

export type AlertStatus = 'ACTIVE' | 'TRIGGERED' | 'CANCELLED';

export interface AssetPriceInfo {
  symbol: string;           // Ký hiệu chuẩn: "XAU", "BTC", "HPG"
  displaySymbol: string;    // Hiển thị đẹp: "XAU/USD", "BTC/USDT", "HPG"
  assetType: AssetType;
  price: number;            // Giá hiện tại theo đơn vị chuẩn
  change24h?: number;       // % thay đổi 24h nếu có
  unit: string;             // "$", "k VNĐ", "VNĐ"
  formattedPrice: string;   // Ví dụ: "$2,685.50", "$83,200.00", "30.50 (30,500đ)"
  exchange?: string;        // "Binance", "TradingView/OANDA", "VPS/HOSE"
}

export interface PriceAlertItem {
  id: number;
  chatId: string;
  username?: string | null;
  symbol: string;
  displaySymbol: string;
  assetType: string;
  targetPrice: number;
  initialPrice: number;
  condition: string;
  status: string;
  triggeredAt?: Date | null;
  triggeredPrice?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ActiveAlertDetail {
  alert: PriceAlertItem;
  currentPrice: number;
  formattedCurrentPrice: string;
  formattedTargetPrice: string;
  formattedInitialPrice: string;
  diffPercent: number;        // % còn lại tới đích (âm là cần giảm, dương là cần tăng)
  distanceText: string;       // "Còn tăng +2.5%" hoặc "Còn giảm -3.2%"
}

export interface CreateAlertResult {
  success: boolean;
  message: string;
  alert?: PriceAlertItem;
  priceInfo?: AssetPriceInfo;
}
