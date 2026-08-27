import { Injectable, Logger } from '@nestjs/common';
import { NewsArticle } from '@prisma/client';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { PrismaService } from '../prisma/prisma.service';

export interface ScrapedNews {
  title: string;
  url: string;
  summary: string;
  source: string;
  symbols: string[];
  publishedAt?: Date;
}

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  // Danh sách các mã cổ phiếu phổ biến trên sàn HSX / HNX
  private readonly popularSymbols = [
    'FPT', 'VNM', 'SSI', 'HPG', 'MBB', 'TCB', 'MWG', 'VHM', 'VIC', 'STB',
    'ACB', 'BID', 'CTG', 'DGC', 'GAS', 'GVR', 'HDB', 'KDH', 'LPB', 'MSN',
    'NLG', 'NVL', 'PDR', 'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'TPB', 'VCB',
    'VIB', 'VJC', 'VND', 'VRE', 'DIG', 'DXG', 'CEO', 'HAG', 'HSG', 'NKG'
  ];

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Quét tin tức chứng khoán từ CafeF / Vietstock / VnEconomy và lưu vào cơ sở dữ liệu
   */
  async fetchAndStoreLatestNews(): Promise<ScrapedNews[]> {
    const scrapedArticles: ScrapedNews[] = [];

    // Nguồn 1: CafeF Chuyên mục Thị trường chứng khoán
    try {
      const response = await axios.get('https://cafef.vn/thi-truong-chung-khoan.chn', {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const $ = cheerio.load(response.data);

      $('.tlitem, .box-category-item, .knc-content, li[data-id]').each((_, el) => {
        const titleEl = $(el).find('h3 a, .title a, a.avatar');
        const title = titleEl.text().trim() || titleEl.attr('title')?.trim();
        let relativeUrl = titleEl.attr('href');
        const summary = $(el).find('.sapo, .summary, p').text().trim();

        if (title && relativeUrl) {
          const url = relativeUrl.startsWith('http') ? relativeUrl : `https://cafef.vn${relativeUrl}`;
          const symbols = this.extractStockSymbols(`${title} ${summary}`);

          scrapedArticles.push({
            title,
            url,
            summary: summary || title,
            source: 'CafeF',
            symbols,
            publishedAt: new Date(),
          });
        }
      });
    } catch (error) {
      this.logger.error(`Lỗi khi quét tin CafeF: ${error.message}`);
    }

    // Nguồn 2: Vietstock Tin Thị Trường
    try {
      const response = await axios.get('https://vietstock.vn/chung-khoan.htm', {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const $ = cheerio.load(response.data);

      $('.channel-news-item, .news-item').each((_, el) => {
        const titleEl = $(el).find('h4 a, h3 a, .title a');
        const title = titleEl.text().trim();
        let relativeUrl = titleEl.attr('href');
        const summary = $(el).find('.sapo, .news-summary').text().trim();

        if (title && relativeUrl) {
          const url = relativeUrl.startsWith('http') ? relativeUrl : `https://vietstock.vn${relativeUrl}`;
          const symbols = this.extractStockSymbols(`${title} ${summary}`);

          scrapedArticles.push({
            title,
            url,
            summary: summary || title,
            source: 'Vietstock',
            symbols,
            publishedAt: new Date(),
          });
        }
      });
    } catch (error) {
      // Bỏ qua nếu có chặn IP Vietstock
    }

    // Luân chuyển lưu tin mới vào Database qua Prisma
    const newSavedArticles: ScrapedNews[] = [];
    for (const article of scrapedArticles) {
      try {
        const existing = await this.prisma.executeWithRetry(() =>
          this.prisma.newsArticle.findUnique({
            where: { url: article.url },
          }),
        );

        if (!existing) {
          await this.prisma.executeWithRetry(() =>
            this.prisma.newsArticle.create({
              data: {
                url: article.url,
                title: article.title,
                summary: article.summary,
                source: article.source,
                symbols: article.symbols,
                publishedAt: article.publishedAt,
                sentToTelegram: false,
              },
            }),
          );
          newSavedArticles.push(article);
        }
      } catch (err) {
        // Bỏ qua lỗi race condition trùng url
      }
    }

    if (newSavedArticles.length > 0) {
      this.logger.log(`📰 Đã tìm thấy ${newSavedArticles.length} tin tức chứng khoán mới!`);
    }
    return newSavedArticles;
  }

  /**
   * Trích xuất các mã chứng khoán xuất hiện trong tiêu đề/nội dung
   */
  extractStockSymbols(text: string): string[] {
    const matchedSymbols = new Set<string>();
    for (const sym of this.popularSymbols) {
      const regex = new RegExp(`\\b${sym}\\b`, 'g');
      if (regex.test(text.toUpperCase())) {
        matchedSymbols.add(sym);
      }
    }
    return Array.from(matchedSymbols);
  }

  /**
   * Lấy TẤT CẢ các tin tức mới chưa được gửi Telegram
   */
  async getUnsentNewsAll(limit = 10): Promise<NewsArticle[]> {
    return this.prisma.executeWithRetry(() =>
      this.prisma.newsArticle.findMany({
        where: { sentToTelegram: false },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Lấy tin tức chưa gửi Telegram cho các mã cổ phiếu trong danh mục
   */
  async getUnsentNewsForSymbols(symbols: string[]) {
    if (!symbols || symbols.length === 0) return [];

    return this.prisma.executeWithRetry(() =>
      this.prisma.newsArticle.findMany({
        where: {
          sentToTelegram: false,
          symbols: {
            hasSome: symbols,
          },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  /**
   * Đánh dấu các tin tức đã được gửi thành công
   */
  async markNewsAsSent(newsIds: number[]) {
    if (!newsIds.length) return;
    await this.prisma.executeWithRetry(() =>
      this.prisma.newsArticle.updateMany({
        where: { id: { in: newsIds } },
        data: { sentToTelegram: true },
      }),
    );
  }

  /**
   * Lấy tin tức mới nhất của 1 mã cổ phiếu
   */
  async getLatestNewsBySymbol(symbol: string, limit = 5) {
    const cleanSym = symbol.toUpperCase();
    return this.prisma.executeWithRetry(() =>
      this.prisma.newsArticle.findMany({
        where: {
          symbols: {
            has: cleanSym,
          },
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }
}
