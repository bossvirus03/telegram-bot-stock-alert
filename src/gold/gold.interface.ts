export type XauTimeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export type RsiZone = 'OVERBOUGHT' | 'OVERSOLD' | 'NORMAL' | 'EXTREME_OVERBOUGHT' | 'EXTREME_OVERSOLD';

export interface XauTimeframeDetail {
  timeframe: XauTimeframe;
  label: string;
  rsi: number;
  zone: RsiZone;
  statusText: string;
  badge: string;
}

export interface XauOverview {
  price: number;
  change: number;
  changePercent: number;
  high24h?: number;
  low24h?: number;
  timeframes: Record<XauTimeframe, XauTimeframeDetail>;
  updatedAt: Date;
  source: string;
}

export interface XauAlertTrigger {
  timeframe: XauTimeframe;
  timeframeLabel: string;
  price: number;
  rsi: number;
  alertType: 'OVERBOUGHT' | 'OVERSOLD';
  level: 'NORMAL_ZONE' | 'EXTREME_ZONE';
  message: string;
  actionAdvice: string;
}

export interface UserXauSettings {
  enabled: boolean;
  timeframes: XauTimeframe[];
  overboughtRsi: number;
  oversoldRsi: number;
}
