import { NewsItem } from './news.interface';
export declare class NewsFetcherService {
    private readonly logger;
    private readonly parser;
    private readonly CAFEF_STOCK_RSS;
    fetchCafeFNews(): Promise<NewsItem[]>;
    private extractStockTickers;
}
