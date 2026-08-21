import { Injectable, Logger } from '@nestjs/common';
import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import { NewsItem } from './news.interface';

@Injectable()
export class NewsFetcherService {
  private readonly logger = new Logger(NewsFetcherService.name);
  private readonly parser = new Parser({
    customFields: {
      item: ['enclosure', 'author', 'description'],
    },
  });

  private readonly CAFEF_STOCK_RSS = 'https://cafef.vn/thi-truong-chung-khoan.rss';
  private readonly INVESTING_STOCK_RSS = 'https://vn.investing.com/rss/news_25.rss';
  private readonly INVESTING_GENERAL_RSS = 'https://vn.investing.com/rss/news.rss';

  /**
   * Lấy tổng hợp tin tức từ cả CafeF và Investing.com Việt Nam
   */
  async fetchAllNews(): Promise<NewsItem[]> {
    const [cafefNews, investingNews] = await Promise.all([
      this.fetchCafeFNews(),
      this.fetchInvestingNews(),
    ]);

    const combined = [...cafefNews, ...investingNews];
    combined.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());

    return combined;
  }

  /**
   * Lấy tin tức từ CafeF
   */
  async fetchCafeFNews(): Promise<NewsItem[]> {
    try {
      this.logger.log(`Tải tin tức từ CafeF: ${this.CAFEF_STOCK_RSS}`);
      const feed = await this.parser.parseURL(this.CAFEF_STOCK_RSS);
      const items: NewsItem[] = [];

      for (const item of feed.items) {
        if (!item.link || !item.title) continue;

        let summary = '';
        let imageUrl: string | undefined = undefined;

        const rawHtml = item.content || (item as any).description || '';
        if (rawHtml) {
          const $ = cheerio.load(rawHtml);

          const imgTag = $('img');
          if (imgTag && imgTag.attr('src')) {
            imageUrl = imgTag.attr('src');
          }
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

      return items;
    } catch (error) {
      this.logger.error(`Lỗi khi cào tin CafeF: ${error.message}`);
      return [];
    }
  }

  /**
   * Lấy tin tức chứng khoán từ Investing.com Việt Nam (vn.investing.com)
   */
  async fetchInvestingNews(): Promise<NewsItem[]> {
    const urls = [this.INVESTING_STOCK_RSS, this.INVESTING_GENERAL_RSS];
    const items: NewsItem[] = [];
    const seenUrls = new Set<string>();

    for (const url of urls) {
      try {
        this.logger.log(`Tải tin tức từ Investing.com: ${url}`);
        const feed = await this.parser.parseURL(url);

        for (const item of feed.items) {
          if (!item.link || !item.title || seenUrls.has(item.link)) continue;
          seenUrls.add(item.link);

          let imageUrl: string | undefined = undefined;
          if (item.enclosure && item.enclosure.url) {
            imageUrl = item.enclosure.url;
          }

          let summary = '';
          const rawText = item.contentSnippet || item.content || (item as any).description || '';
          if (rawText) {
            const $ = cheerio.load(rawText);
            summary = $.text().trim();
          }

          const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();
          const tickers = this.extractStockTickers(`${item.title} ${summary}`);

          items.push({
            title: item.title.trim(),
            url: item.link.trim(),
            summary: summary,
            imageUrl: imageUrl,
            source: 'Investing.com',
            tickers: tickers,
            publishedAt: pubDate,
          });
        }
      } catch (error) {
        this.logger.error(`Lỗi khi cào tin tức từ Investing.com [${url}]: ${error.message}`);
      }
    }

    this.logger.log(`Thu thập thành công ${items.length} tin tức từ Investing.com`);
    return items;
  }

  /**
   * Trích xuất các mã chứng khoán (Tickers) xuất hiện trong tiêu đề và nội dung
   */
  private extractStockTickers(text: string): string[] {
    if (!text) return [];

    const regex = /\b([A-Z]{3}|VN-INDEX|VNINDEX|HNX-INDEX|S&P 500|NASDAQ)\b/g;
    const matches = text.match(regex) || [];

    const stopWords = new Set([
      'HOT', 'NEW', 'RSS', 'TOP', 'CEO', 'CFO', 'CTHD', 'TND', 'USD', 'VND',
      'EUR', 'JPY', 'GBP', 'BOT', 'API', 'APP', 'WEB', 'DAT', 'NAY', 'XEM',
      'BAN', 'MUA', 'OAT', 'NHM', 'EPS', 'FED', 'TSX', 'UBS'
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
