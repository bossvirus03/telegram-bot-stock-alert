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

  // Danh sách các mã cổ phiếu phổ biến trên sàn HSX / HNX / UPCOM
  private readonly popularSymbols = [
    // VN30 & Bluechips
    'ACB', 'BCM', 'BID', 'BVH', 'CTG', 'FPT', 'GAS', 'GVR', 'HDB', 'HPG',
    'MBB', 'MSN', 'MWG', 'PLX', 'POW', 'SAB', 'SHB', 'SSB', 'SSI', 'STB',
    'TCB', 'TPB', 'VCB', 'VHM', 'VIB', 'VIC', 'VJC', 'VNM', 'VPB', 'VRE',
    // Ngân hàng & Tài chính & Chứng khoán
    'EIB', 'LPB', 'MSB', 'OCB', 'NAB', 'BAB', 'BVB', 'KLB', 'NVB', 'PGB',
    'VCI', 'VND', 'HCM', 'MBS', 'SHS', 'BSI', 'CTS', 'FTS', 'AGR', 'VIX',
    'ORS', 'BVS', 'TVS', 'VDS', 'DSC',
    // Thép & Kim loại & Vật liệu xây dựng
    'HSG', 'NKG', 'VGS', 'TLH', 'SMC', 'HT1', 'BCC', 'VCS',
    // Bất động sản & Xây dựng & KCN
    'DIG', 'DXG', 'CEO', 'NVL', 'PDR', 'KDH', 'NLG', 'KBC', 'IDC', 'VGC',
    'SZC', 'BCG', 'HQC', 'SCR', 'DXS', 'HDC', 'TCH', 'KHG', 'CIENCO4',
    'C4G', 'HHV', 'VCG', 'LCG', 'FCN', 'CTD', 'HBC', 'DHA',
    // Dầu khí & Hóa chất & Phân bón
    'PVD', 'PVS', 'PVT', 'PVC', 'BSR', 'OIL', 'DGC', 'DCM', 'DPM', 'CSV',
    'LAS', 'BFC', 'PHR', 'DPR', 'DRI',
    // Công nghệ & Viễn thông & Bán lẻ & Tiêu dùng
    'CMG', 'CTR', 'VGI', 'FOX', 'FRT', 'DGW', 'PET', 'PNJ', 'MSN', 'MCH',
    'KDC', 'SBT', 'QNS', 'ANV', 'VHC', 'IDI', 'FMC', 'BAF', 'DBC', 'HAG',
    'HNG',
    // Cảng biển & Logistics & Vận tải
    'GMD', 'HAH', 'VSC', 'PVT', 'VOS', 'TMS', 'VTP',
    // Năng lượng & Điện & Nước
    'GEG', 'REE', 'PC1', 'HDG', 'NT2', 'GELEX', 'GEX', 'TDM', 'BWE',
    // Dệt may & Thủy sản & Khác
    'TNG', 'MSH', 'STK', 'TCM', 'BMP', 'NTP', 'DRC', 'CSM'
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
            publishedAt: this.extractPublishDate(url),
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
  extractStockSymbols(text: string, extraSymbols: string[] = []): string[] {
    const matchedSymbols = new Set<string>();
    const allSymbolsToCheck = Array.from(new Set([...this.popularSymbols, ...extraSymbols]));
    const upperText = text.toUpperCase();

    for (const sym of allSymbolsToCheck) {
      if (!sym) continue;
      const cleanSym = sym.trim().toUpperCase();
      const regex = new RegExp(`\\b${cleanSym}\\b`, 'g');
      if (regex.test(upperText)) {
        matchedSymbols.add(cleanSym);
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
   * Quét trực tiếp tin tức theo từng mã cổ phiếu từ trang tìm kiếm/tag của CafeF
   */
  async scrapeNewsForSymbol(symbol: string): Promise<ScrapedNews[]> {
    const cleanSym = symbol.toUpperCase();
    const scrapedArticles: ScrapedNews[] = [];

    try {
      let url = `https://cafef.vn/tap-doan-${cleanSym.toLowerCase()}.html`;
      let res;
      try {
        res = await axios.get(url, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
      } catch {
        url = `https://cafef.vn/tim-kiem.chn?keywords=${cleanSym}`;
        res = await axios.get(url, {
          timeout: 5000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
      }

      const $ = cheerio.load(res.data);

      $('h3 a, .title a, a.avatar, .timeline-item a').each((_, el) => {
        const title = $(el).text().trim() || $(el).attr('title')?.trim();
        const href = $(el).attr('href');
        if (title && href && title.length > 15 && href.endsWith('.chn')) {
          const fullUrl = href.startsWith('http') ? href : `https://cafef.vn${href}`;
          
          if (!scrapedArticles.some((a) => a.url === fullUrl)) {
            scrapedArticles.push({
              title,
              url: fullUrl,
              summary: title,
              source: 'CafeF',
              symbols: [cleanSym],
              publishedAt: this.extractPublishDate(fullUrl),
            });
          }
        }
      });

      // Lưu tin bài quét được vào Database
      for (const article of scrapedArticles.slice(0, 10)) {
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
                  sentToTelegram: true, // Đánh dấu đã xử lý để không kích hoạt broadcast ngầm trùng lặp
                },
              }),
            );
          }
        } catch (err) {
          // Bỏ qua nếu tin trùng URL
        }
      }
    } catch (error) {
      this.logger.error(`Lỗi khi quét tin tức mã ${cleanSym}: ${error.message}`);
    }

    return scrapedArticles;
  }

  /**
   * Lấy tin tức chuẩn xác 100% của 1 mã cổ phiếu (Tự động cào tin mới theo mã)
   */
  async getLatestNewsBySymbol(symbol: string, limit = 5) {
    const cleanSym = symbol.toUpperCase();

    // 1. Thử lấy tin trong DB gắn thẻ hoặc có chứa tên mã cổ phiếu
    let articles = await this.prisma.executeWithRetry(() =>
      this.prisma.newsArticle.findMany({
        where: {
          OR: [
            { symbols: { has: cleanSym } },
            { title: { contains: cleanSym, mode: 'insensitive' } },
            { summary: { contains: cleanSym, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    );

    // 2. Nếu ít hơn 3 tin, kích hoạt cào tin chính xác mã cổ phiếu từ CafeF
    if (articles.length < 3) {
      await this.scrapeNewsForSymbol(cleanSym);

      articles = await this.prisma.executeWithRetry(() =>
        this.prisma.newsArticle.findMany({
          where: {
            OR: [
              { symbols: { has: cleanSym } },
              { title: { contains: cleanSym, mode: 'insensitive' } },
              { summary: { contains: cleanSym, mode: 'insensitive' } },
            ],
          },
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
      );
    }

    return articles;
  }

  /**
   * Trích xuất thời gian phát hành bài báo thực tế từ URL của CafeF
   */
  private extractPublishDate(url: string): Date {
    try {
      // Regex 1: Chuỗi CafeF 188 YY MM DD HH MM (VD: 188260805135155233.chn -> 05/08/2026 13:51)
      const match188 = url.match(/188(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (match188) {
        const year = 2000 + parseInt(match188[1], 10);
        const month = parseInt(match188[2], 10) - 1;
        const day = parseInt(match188[3], 10);
        const hour = parseInt(match188[4], 10);
        const min = parseInt(match188[5], 10);
        return new Date(year, month, day, hour, min);
      }

      // Regex 2: Chuỗi YYYY MM DD HH MM (VD: 202608051351)
      const matchFullYear = url.match(/(202[4-9])(\d{2})(\d{2})(\d{2})(\d{2})/);
      if (matchFullYear) {
        const year = parseInt(matchFullYear[1], 10);
        const month = parseInt(matchFullYear[2], 10) - 1;
        const day = parseInt(matchFullYear[3], 10);
        const hour = parseInt(matchFullYear[4], 10);
        const min = parseInt(matchFullYear[5], 10);
        return new Date(year, month, day, hour, min);
      }
    } catch {}

    return new Date();
  }
}
