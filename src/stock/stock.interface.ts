export interface StockDetail {
  symbol: string;
  name?: string;
  currentPrice: number; // Đơn vị 1,000 VND (Ví dụ: 130.5 = 130,500đ)
  change: number;
  changePercent: number;
  refPrice: number;
  highPrice: number;
  lowPrice: number;
  totalVolume: number;
  activeBuyVolume: number;
  activeSellVolume: number;
  netActiveBuyVolume: number; // Active Buy - Active Sell
  netActiveBuyValue: number; // Tính theo tỷ đồng hoặc triệu đồng
  foreignBuyVolume: number;
  foreignSellVolume: number;
  foreignNetBuyVolume: number;
  flowTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  updatedAt: Date;
}

export interface MarketTopFlow {
  symbol: string;
  price: number;
  changePercent: number;
  netActiveValueBillion: number;
}
