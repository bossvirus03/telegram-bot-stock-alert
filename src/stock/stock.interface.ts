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

export interface FinancialRatio {
  pe: number; // Price to Earnings
  pb: number; // Price to Book
  roe: number; // Return on Equity (%)
  roa: number; // Return on Assets (%)
  eps: number; // Earnings Per Share (VND)
  revenueGrowth: number; // Tăng trưởng doanh thu YoY (%)
  profitGrowth: number; // Tăng trưởng lợi nhuận YoY (%)
  deRatio: number; // Nợ / Vốn chủ sở hữu (D/E)
  grossMargin: number; // Biên lợi nhuận gộp (%)
  netMargin: number; // Biên lợi nhuận ròng (%)
  revenue: number; // Doanh thu (Tỷ VNĐ)
  netProfit: number; // Lợi nhuận ròng (Tỷ VNĐ)
  totalAssets: number; // Tổng tài sản (Tỷ VNĐ)
  equity: number; // Vốn chủ sở hữu (Tỷ VNĐ)
  reportPeriod?: string; // Kỳ báo cáo (VD: Quý 2/2024)
  publishDate?: string; // Ngày công bố / xuất báo cáo (VD: 25/07/2024)
}

export interface AvailablePeriod {
  quarter: number;
  year: number;
  label: string;
}

export interface FinancialAnalysis {
  symbol: string;
  name: string;
  reportPeriod: string;
  publishDate: string;
  ratios: FinancialRatio;
  healthScore: number; // Từ 1 - 5 sao
  healthStatus: 'EXCELLENT' | 'GOOD' | 'NEUTRAL' | 'WARNING' | 'RISKY';
  valuationStatus: 'CHEAP' | 'FAIR' | 'EXPENSIVE';
  strengths: string[];
  risks: string[];
  recommendation: string;
  availablePeriods?: AvailablePeriod[];
  updatedAt: Date;
}
