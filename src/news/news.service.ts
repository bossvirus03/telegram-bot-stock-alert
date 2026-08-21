import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NewsItem } from './news.interface';
import { News } from '@prisma/client';

@Injectable()
export class NewsService {
  private readonly logger = new Logger(NewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lưu danh sách tin tức mới vào DB và trả về danh sách các tin MỚI CHƯA CÓ TRONG DB
   */
  async saveAndFilterNewNews(items: NewsItem[]): Promise<NewsItem[]> {
    const newItems: NewsItem[] = [];

    for (const item of items) {
      try {
        const existing = await this.prisma.news.findUnique({
          where: { url: item.url },
        });

        if (!existing) {
          await this.prisma.news.create({
            data: {
              title: item.title,
              url: item.url,
              summary: item.summary,
              imageUrl: item.imageUrl,
              source: item.source,
              tickers: item.tickers,
              publishedAt: item.publishedAt,
            },
          });

          newItems.push(item);
        }
      } catch (error) {
        this.logger.error(`Lỗi khi lưu tin tức [${item.url}]: ${error.message}`);
      }
    }

    return newItems;
  }

  /**
   * Lấy N tin tức chứng khoán mới nhất
   */
  async getLatestNews(limit = 10): Promise<News[]> {
    return this.prisma.news.findMany({
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Tìm kiếm tin tức theo Mã Cổ Phiếu (ticker)
   */
  async searchNewsByTicker(ticker: string, limit = 10): Promise<News[]> {
    const upperTicker = ticker.toUpperCase();
    return this.prisma.news.findMany({
      where: {
        tickers: {
          has: upperTicker,
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });
  }
}
