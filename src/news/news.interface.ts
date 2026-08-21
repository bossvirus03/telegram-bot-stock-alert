export interface NewsItem {
  title: string;
  url: string;
  summary?: string;
  imageUrl?: string;
  source: string;
  tickers: string[];
  publishedAt: Date;
}
