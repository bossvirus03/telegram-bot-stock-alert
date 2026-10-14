export type EmaTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export type EmaCrossType = 'BULLISH' | 'BEARISH';

export interface EmaPreset {
  id: string;
  name: string;
  fast: number;
  slow: number;
  description: string;
}

export interface EmaIndicatorState {
  symbol: string;
  displaySymbol: string;
  assetType: 'GOLD' | 'CRYPTO';
  timeframe: EmaTimeframe;
  fastPeriod: number;
  slowPeriod: number;
  currentPrice: number;
  fastValue: number;
  slowValue: number;
  prevFastValue: number;
  prevSlowValue: number;
  diffPercent: number; // Chênh lệch % giữa fast và slow
  trend: 'BULLISH' | 'BEARISH'; // Fast > Slow là Bullish, ngược lại là Bearish
  crossDetected: EmaCrossType | null; // Có vừa xảy ra giao cắt ở nến này không
  updatedAt: Date;
}

export interface EmaAlertItem {
  id: number;
  chatId: string;
  username?: string | null;
  symbol: string;
  displaySymbol: string;
  assetType: string;
  timeframe: string;
  fastPeriod: number;
  slowPeriod: number;
  lastCrossType?: string | null;
  lastCrossPrice?: number | null;
  lastTriggeredAt?: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEmaAlertDto {
  chatId: string;
  username?: string;
  symbol: string;
  timeframe: EmaTimeframe;
  fastPeriod: number;
  slowPeriod: number;
}

export interface CreateEmaAlertResult {
  success: boolean;
  message: string;
  alert?: EmaAlertItem;
  state?: EmaIndicatorState;
}

export interface ActiveEmaAlertDetail {
  alert: EmaAlertItem;
  state?: EmaIndicatorState;
  statusText: string;
}
