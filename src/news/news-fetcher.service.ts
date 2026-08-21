import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { NewsItem } from './news.interface';

@Injectable()
export class NewsFetcherService {
  private readonly logger = new Logger(NewsFetcherService.name);
  private readonly parser = new Parser();
  private readonly CAFEF_STOCK_RSS = 'https://cafef.vn/thi-truong-chung-khoan.rss';

  /**
   * Lấy danh sách tin tức mới nhất từ trang CafeF
   */
  async fetchCafeFNews(): Promise<NewsItem[]> {
    try {
      this.logger.log(`Bắt đầu tải RSS tin tức từ CafeF: ${this.CAFEF_STOCK_RSS}`);
      const feed = await this.parser.parseURL(this.CAFEF_STOCK_RSS);

      const items: NewsItem[] = [];

      for (const item of feed.items) {
        if (!item.link || !item.title) continue;

        let summary = '';
        let imageUrl: string | undefined = undefined;

        if (item.content || item.description) {
          const rawHtml = item.content || item.description || '';
          const $ = cheerio.load(rawHtml);

          // Lấy hình ảnh từ thẻ <img> trong description
          const imgTag = $('img');
          if (imgTag && imgTag.attr('src')) {
            imageUrl = imgTag.attr('src');
          }

          // Lấy văn bản tóm tắt
          summary = $.text().trim();
        }

        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
        const tickers = this.extractStockTickers(`${item.title} ${summary}`);

        items.push({
          title: item.title.trim(),
          url: item.link.trim(),
          summary: summary,
          imageUrl: imageUrl,
          source: 'CafeF',
          tickers: tickers,
          publishedAt: pubDate,
        });
      }

      this.logger.log(`Thu thập thành công ${items.length} tin tức từ CafeF`);
      return items;
    } catch (error) {
      this.logger.error(`Lỗi khi cào tin tức CafeF: ${error.message}`, error.stack);
      return [];
    }
  }

  /**
   * Trích xuất các mã chứng khoán (Tickers) xuất hiện trong tiêu đề và nội dung
   */
  private extractStockTickers(text: string): string[] {
    if (!text) return [];

    const regex = /\b([A-Z]{3}|VN-INDEX|VNINDEX|HNX-INDEX)\b/g;
    const matches = text.match(regex) || [];

    const stopWords = new Set([
      'HOT', 'NEW', 'RSS', 'TOP', 'CEO', 'CFO', 'CTHD', 'TND', 'USD', 'VND',
      'EUR', 'JPY', 'GBP', 'BOT', 'API', 'APP', 'WEB', 'DAT', 'NAY', 'XEM',
      'BAN', 'MUA', 'OAT', 'NHM'
    ]);

    const uniqueTickers = new Set<string>();

    for (const match of matches) {
      const cleanMatch = match.replace('-', '').toUpperCase();
      if (!stopWords.has(cleanMatch)) {
        uniqueTickers.add(cleanMatch);
      }
    }

    return Array.from(uniqueTickers);
  }
}
