import { NewsItem } from './news.interface';
export declare class NewsFetcherService {
    private readonly logger;
    private readonly parser;
    private readonly CAFEF_STOCK_RSS;
    private readonly INVESTING_STOCK_RSS;
    private readonly INVESTING_GENERAL_RSS;
    fetchAllNews(): Promise<NewsItem[]>;
    fetchCafeFNews(): Promise<NewsItem[]>;
    fetchInvestingNews(): Promise<NewsItem[]>;
    private extractStockTickers;
}
