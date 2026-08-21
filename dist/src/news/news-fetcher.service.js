"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var NewsFetcherService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NewsFetcherService = void 0;
const common_1 = require("@nestjs/common");
const rss_parser_1 = __importDefault(require("rss-parser"));
const cheerio = __importStar(require("cheerio"));
let NewsFetcherService = NewsFetcherService_1 = class NewsFetcherService {
    logger = new common_1.Logger(NewsFetcherService_1.name);
    parser = new rss_parser_1.default({
        customFields: {
            item: ['enclosure', 'author', 'description'],
        },
    });
    CAFEF_STOCK_RSS = 'https://cafef.vn/thi-truong-chung-khoan.rss';
    INVESTING_STOCK_RSS = 'https://vn.investing.com/rss/news_25.rss';
    INVESTING_GENERAL_RSS = 'https://vn.investing.com/rss/news.rss';
    async fetchAllNews() {
        const [cafefNews, investingNews] = await Promise.all([
            this.fetchCafeFNews(),
            this.fetchInvestingNews(),
        ]);
        const combined = [...cafefNews, ...investingNews];
        combined.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
        return combined;
    }
    async fetchCafeFNews() {
        try {
            this.logger.log(`Tải tin tức từ CafeF: ${this.CAFEF_STOCK_RSS}`);
            const feed = await this.parser.parseURL(this.CAFEF_STOCK_RSS);
            const items = [];
            for (const item of feed.items) {
                if (!item.link || !item.title)
                    continue;
                let summary = '';
                let imageUrl = undefined;
                const rawHtml = item.content || item.description || '';
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
        }
        catch (error) {
            this.logger.error(`Lỗi khi cào tin CafeF: ${error.message}`);
            return [];
        }
    }
    async fetchInvestingNews() {
        const urls = [this.INVESTING_STOCK_RSS, this.INVESTING_GENERAL_RSS];
        const items = [];
        const seenUrls = new Set();
        for (const url of urls) {
            try {
                this.logger.log(`Tải tin tức từ Investing.com: ${url}`);
                const feed = await this.parser.parseURL(url);
                for (const item of feed.items) {
                    if (!item.link || !item.title || seenUrls.has(item.link))
                        continue;
                    seenUrls.add(item.link);
                    let imageUrl = undefined;
                    if (item.enclosure && item.enclosure.url) {
                        imageUrl = item.enclosure.url;
                    }
                    let summary = '';
                    const rawText = item.contentSnippet || item.content || item.description || '';
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
            }
            catch (error) {
                this.logger.error(`Lỗi khi cào tin tức từ Investing.com [${url}]: ${error.message}`);
            }
        }
        this.logger.log(`Thu thập thành công ${items.length} tin tức từ Investing.com`);
        return items;
    }
    extractStockTickers(text) {
        if (!text)
            return [];
        const regex = /\b([A-Z]{3}|VN-INDEX|VNINDEX|HNX-INDEX|S&P 500|NASDAQ)\b/g;
        const matches = text.match(regex) || [];
        const stopWords = new Set([
            'HOT', 'NEW', 'RSS', 'TOP', 'CEO', 'CFO', 'CTHD', 'TND', 'USD', 'VND',
            'EUR', 'JPY', 'GBP', 'BOT', 'API', 'APP', 'WEB', 'DAT', 'NAY', 'XEM',
            'BAN', 'MUA', 'OAT', 'NHM', 'EPS', 'FED', 'TSX', 'UBS'
        ]);
        const uniqueTickers = new Set();
        for (const match of matches) {
            const cleanMatch = match.replace('-', '').toUpperCase();
            if (!stopWords.has(cleanMatch)) {
                uniqueTickers.add(cleanMatch);
            }
        }
        return Array.from(uniqueTickers);
    }
};
exports.NewsFetcherService = NewsFetcherService;
exports.NewsFetcherService = NewsFetcherService = NewsFetcherService_1 = __decorate([
    (0, common_1.Injectable)()
], NewsFetcherService);
//# sourceMappingURL=news-fetcher.service.js.map