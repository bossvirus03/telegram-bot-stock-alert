import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { StockDetail, FinancialAnalysis, TechnicalIndicators, SafeBuyZone, ScenarioModel } from '../stock/stock.interface';
import { NewsArticle } from '@prisma/client';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private aiClient: GoogleGenAI | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY') || process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.aiClient = new GoogleGenAI({ apiKey });
      this.logger.log('🤖 Đã khởi tạo kết nối Google Gemini AI SDK!');
    } else {
      this.logger.warn('⚠️ Chưa cấu hình GEMINI_API_KEY. Hệ thống sẽ sử dụng AI Decision Engine nội bộ.');
    }
  }

  /**
   * Phân tích cổ phiếu toàn diện bằng Gemini AI hoặc Engine nội bộ
   * Với dữ liệu kỹ thuật THỰC TẾ
   */
  async analyzeStockWithAi(
    symbol: string,
    stockDetail: StockDetail,
    financial: FinancialAnalysis,
    newsArticles: NewsArticle[],
    technicals: TechnicalIndicators,
    safeBuy: SafeBuyZone,
    scenarios: ScenarioModel,
    section: 'summary' | 'short' | 'long' | 'valuation' | 'catalyst' | 'full' = 'summary',
  ): Promise<string> {
    const cleanSym = symbol.toUpperCase();

    // 1. Thử gọi API Google Gemini AI nếu có API Key
    if (this.aiClient) {
      const prompt = this.buildGeminiPrompt(cleanSym, stockDetail, financial, newsArticles, technicals, safeBuy, scenarios, section);
      const modelsToTry = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'];

      for (const modelName of modelsToTry) {
        try {
          const response = await this.aiClient.models.generateContent({
            model: modelName,
            contents: prompt,
          });

          const text = response.text;
          if (text && text.length > 50) {
            this.logger.log(`✅ Đã phân tích thành công mã ${cleanSym} bằng Gemini Model: ${modelName}`);
            return this.sanitizeHtmlForTelegram(text);
          }
        } catch (error) {
          this.logger.debug(`Model ${modelName} không phản hồi (${error.message}), đang thử model tiếp theo...`);
        }
      }
    }

    // 2. Fallback sang Bộ tính toán AI Decision Engine nội bộ
    return this.generateInternalAiAnalysis(cleanSym, stockDetail, financial, newsArticles, technicals, safeBuy, scenarios, section);
  }

  /**
   * Tạo Prompt Gemini AI với dữ liệu kỹ thuật thực tế
   */
  private buildGeminiPrompt(
    symbol: string,
    detail: StockDetail,
    financial: FinancialAnalysis,
    news: NewsArticle[],
    tech: TechnicalIndicators,
    safeBuy: SafeBuyZone,
    scenarios: ScenarioModel,
    section: string,
  ): string {
    const newsHeadlines = news.map((n) => `- ${n.title}`).join('\n');
    const r = financial.ratios;

    return `
Bạn là một Chuyên gia Phân tích Đầu tư Chứng khoán Cao cấp và Nhà Quản lý Quỹ Tài chính tại Việt Nam.
Hãy phân tích mã cổ phiếu ${symbol} dựa trên dữ liệu THỰC TẾ sau:

--- DỮ LIỆU THỊ TRƯỜNG THỜI GIAN THỰC ---
- Mã cổ phiếu: ${symbol}
- Giá hiện tại: ${detail.currentPrice}k VNĐ (Thay đổi: ${detail.changePercent > 0 ? '+' : ''}${detail.changePercent}%)
- Giá tham chiếu: ${detail.refPrice}k, Cao nhất: ${detail.highPrice}k, Thấp nhất: ${detail.lowPrice}k
- Tổng khối lượng giao dịch: ${detail.totalVolume.toLocaleString('vi-VN')} CP
- Dòng tiền Mua ròng chủ động: ${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ (${detail.flowTrend})
- Khối ngoại Mua/Bán ròng: ${detail.foreignNetBuyVolume > 0 ? '+' : ''}${detail.foreignNetBuyVolume.toLocaleString('vi-VN')} CP

--- CHỈ BÁO KỸ THUẬT THỰC TẾ (tính từ 120 phiên lịch sử) ---
- MA20: ${tech.ma20}k | MA50: ${tech.ma50}k | MA200: ${tech.ma200}k
- RSI (14): ${tech.rsi14}
- MACD: ${tech.macd.macd} | Signal: ${tech.macd.signal} | Histogram: ${tech.macd.histogram}
- Bollinger Bands: Upper ${tech.bollingerBands.upper}k | Middle ${tech.bollingerBands.middle}k | Lower ${tech.bollingerBands.lower}k
- Hỗ trợ (Support): ${tech.support.length > 0 ? tech.support.map(s => s + 'k').join(', ') : 'Chưa xác định'}
- Kháng cự (Resistance): ${tech.resistance.length > 0 ? tech.resistance.map(r => r + 'k').join(', ') : 'Chưa xác định'}
- Xu hướng: ${tech.trend} (${tech.trendStrength})
- Volume so với trung bình: ${tech.currentVolumeRatio}x
- Tín hiệu kỹ thuật: ${tech.signals.join(' | ')}

--- ĐIỂM MUA AN TOÀN ---
- Giá mua lý tưởng: ${safeBuy.idealBuyPrice}k | Vùng mua: ${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k
- Target ngắn hạn: ${safeBuy.targetShortTerm}k | Target dài hạn: ${safeBuy.targetLongTerm}k
- Stop Loss: ${safeBuy.stopLoss}k
- R/R ngắn hạn: 1:${safeBuy.riskRewardShort} | R/R dài hạn: 1:${safeBuy.riskRewardLong}
- Độ tin cậy: ${safeBuy.confidence}

--- MÔ HÌNH 3 KỊCH BẢN ---
- Bull Case: ${scenarios.bullCase.targetPrice}k (${scenarios.bullCase.probability}%) - ${scenarios.bullCase.description}
- Base Case: ${scenarios.baseCase.targetPrice}k (${scenarios.baseCase.probability}%) - ${scenarios.baseCase.description}
- Bear Case: ${scenarios.bearCase.targetPrice}k (${scenarios.bearCase.probability}%) - ${scenarios.bearCase.description}

--- BÁO CÁO TÀI CHÍNH KỲ ${financial.reportPeriod} ---
- P/E: ${r.pe} lần, P/B: ${r.pb} lần, EPS: ${r.eps} VNĐ
- ROE: ${r.roe}%, ROA: ${r.roa}%
- Tăng trưởng Doanh thu: ${r.revenueGrowth}%, Tăng trưởng Lợi nhuận: ${r.profitGrowth}%
- Nợ / Vốn chủ sở hữu (D/E): ${r.deRatio} lần
- Biên lợi nhuận gộp: ${r.grossMargin}%, Biên lợi nhuận ròng: ${r.netMargin}%
- Doanh thu: ${r.revenue} Tỷ VNĐ, Lợi nhuận ròng: ${r.netProfit} Tỷ VNĐ
- Sức khỏe tài chính: ${financial.healthStatus} (${financial.healthScore}/5)

--- TIN TỨC MỚI NHẤT ---
${newsHeadlines || 'Không có tin tức đột biến gần đây.'}

--- YÊU CẦU PHÂN TÍCH (Mục ${section}) ---
Hãy lập Báo cáo Phân tích Đầu tư chuyên sâu theo format HTML cho Telegram (dùng <b>, <i>, <code>, KHÔNG dùng markdown ** hay ###).

${section === 'summary' ? `
Viết BÁO CÁO TỔNG QUAN gồm:
1. Nhận định ngắn hạn (1-4 tuần): Xu hướng, tín hiệu mua/bán, vùng giá mua an toàn, target, stoploss, R/R
2. Nhận định dài hạn (3-12 tháng): Tăng trưởng, định giá, biên lợi nhuận
3. Mô hình 3 kịch bản với xác suất
4. Khuyến nghị hành động cụ thể
` : section === 'short' ? `
Viết PHÂN TÍCH NGẮN HẠN CHI TIẾT gồm:
1. Phân tích kỹ thuật đầy đủ: RSI, MACD, MA, Bollinger, Support/Resistance, Volume
2. Kế hoạch Trading: Giá mua, Target, Stop Loss, Tỷ lệ R/R
3. Biên ngắn hạn: Lợi nhuận kỳ vọng vs Rủi ro
4. Mô hình dự kiến ngắn hạn (1-4 tuần)
5. Điểm mua an toàn chi tiết
` : section === 'long' ? `
Viết PHÂN TÍCH DÀI HẠN CHI TIẾT gồm:
1. Tăng trưởng Doanh thu/LNST/EPS qua các kỳ
2. Chất lượng lợi nhuận: Gross/Net Margin, ROE/ROA
3. Cơ cấu nợ D/E, Bảng cân đối kế toán
4. Biên dài hạn: Mục tiêu giá 3-12 tháng
5. Kịch bản dài hạn
` : section === 'valuation' ? `
Viết PHÂN TÍCH ĐỊNH GIÁ & MOAT gồm:
1. Chỉ số định giá: P/E, P/B, PEG so với ngành
2. Lợi thế cạnh tranh (Economic Moat)
3. Ban lãnh đạo, cổ tức, ESOP
4. Fair value estimation
` : `
Viết PHÂN TÍCH CATALYST & VĨ MÔ gồm:
1. Chu kỳ ngành, lãi suất, tỷ giá
2. Chính sách vĩ mô, đầu tư công
3. Động lực tăng giá chính (Investment Thesis)
4. Tin tức hỗ trợ/tiêu cực
`}

Yêu cầu: Ngắn gọn, chuyên nghiệp, có số liệu cụ thể, bằng Tiếng Việt.
`;
  }

  /**
   * Engine nội bộ - Tạo báo cáo dựa trên dữ liệu kỹ thuật THỰC TẾ
   */
  private generateInternalAiAnalysis(
    symbol: string,
    detail: StockDetail,
    financial: FinancialAnalysis,
    news: NewsArticle[],
    tech: TechnicalIndicators,
    safeBuy: SafeBuyZone,
    scenarios: ScenarioModel,
    section: string,
  ): string {
    const r = financial.ratios;
    const price = detail.currentPrice;

    if (section === 'short') {
      return this.buildShortTermReport(symbol, detail, tech, safeBuy, scenarios);
    }

    if (section === 'long') {
      return this.buildLongTermReport(symbol, detail, financial, tech, safeBuy, scenarios);
    }

    if (section === 'valuation') {
      return this.buildValuationReport(symbol, detail, financial, tech);
    }

    if (section === 'catalyst') {
      return this.buildCatalystReport(symbol, detail, financial, tech, news);
    }

    // Summary (Tổng quan)
    return this.buildSummaryReport(symbol, detail, financial, tech, safeBuy, scenarios, news);
  }

  private buildSummaryReport(
    symbol: string, detail: StockDetail, financial: FinancialAnalysis,
    tech: TechnicalIndicators, safeBuy: SafeBuyZone, scenarios: ScenarioModel,
    news: NewsArticle[],
  ): string {
    const r = financial.ratios;
    const price = detail.currentPrice;
    const trendIcon = tech.trend === 'UPTREND' ? '🟢 TĂNG' : tech.trend === 'DOWNTREND' ? '🔴 GIẢM' : '🟡 ĐI NGANG';
    const confidenceIcon = safeBuy.confidence === 'HIGH' ? '🟢' : safeBuy.confidence === 'MEDIUM' ? '🟡' : '🔴';
    const gainPctShort = price > 0 ? (((safeBuy.targetShortTerm - price) / price) * 100).toFixed(1) : '0';
    const gainPctLong = price > 0 ? (((safeBuy.targetLongTerm - price) / price) * 100).toFixed(1) : '0';

    let msg = `🤖 <b>BÁO CÁO PHÂN TÍCH TOÀN DIỆN - MÃ ${symbol}</b>\n`;
    msg += `📅 <b>BCTC:</b> ${financial.reportPeriod} | <b>Giá:</b> ${price}k (${detail.changePercent > 0 ? '+' : ''}${detail.changePercent}%)\n\n`;

    // Tổng quan kỹ thuật
    msg += `📊 <b>CHỈ BÁO KỸ THUẬT:</b>\n`;
    msg += `  • <b>Xu hướng:</b> ${trendIcon} (${tech.trendStrength})\n`;
    msg += `  • <b>RSI (14):</b> <code>${tech.rsi14}</code> | <b>MACD:</b> <code>${tech.macd.histogram > 0 ? '▲' : '▼'} ${tech.macd.histogram}</code>\n`;
    msg += `  • <b>MA20:</b> ${tech.ma20}k | <b>MA50:</b> ${tech.ma50}k | <b>MA200:</b> ${tech.ma200}k\n`;
    msg += `  • <b>BB:</b> ${tech.bollingerBands.lower}k - ${tech.bollingerBands.upper}k\n\n`;

    // Tín hiệu chính
    msg += `⚡ <b>TÍN HIỆU CHÍNH:</b>\n`;
    tech.signals.slice(0, 4).forEach(s => { msg += `  ${s}\n`; });
    msg += `\n`;

    // Điểm mua an toàn
    msg += `🎯 <b>ĐIỂM MUA AN TOÀN:</b> ${confidenceIcon} Tin cậy: ${safeBuy.confidence}\n`;
    msg += `  • <b>Giá mua lý tưởng:</b> <code>${safeBuy.idealBuyPrice}k</code>\n`;
    msg += `  • <b>Vùng mua:</b> <code>${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k</code>\n`;
    msg += `  • <b>Target ngắn hạn:</b> <code>${safeBuy.targetShortTerm}k</code> (<b>+${gainPctShort}%</b>)\n`;
    msg += `  • <b>Target dài hạn:</b> <code>${safeBuy.targetLongTerm}k</code> (<b>+${gainPctLong}%</b>)\n`;
    msg += `  • <b>Stop Loss:</b> <code>${safeBuy.stopLoss}k</code> | <b>R/R:</b> 1:${safeBuy.riskRewardShort} (ngắn) / 1:${safeBuy.riskRewardLong} (dài)\n\n`;

    // Mô hình 3 kịch bản
    msg += `📈 <b>MÔ HÌNH 3 KỊCH BẢN:</b>\n`;
    msg += `  🟢 <b>Bull:</b> ${scenarios.bullCase.targetPrice}k (+${(((scenarios.bullCase.targetPrice - price) / price) * 100).toFixed(1)}%) - Xác suất <b>${scenarios.bullCase.probability}%</b>\n`;
    msg += `  🟡 <b>Base:</b> ${scenarios.baseCase.targetPrice}k (${(((scenarios.baseCase.targetPrice - price) / price) * 100).toFixed(1)}%) - Xác suất <b>${scenarios.baseCase.probability}%</b>\n`;
    msg += `  🔴 <b>Bear:</b> ${scenarios.bearCase.targetPrice}k (${(((scenarios.bearCase.targetPrice - price) / price) * 100).toFixed(1)}%) - Xác suất <b>${scenarios.bearCase.probability}%</b>\n\n`;

    // BCTC tóm tắt
    msg += `🏦 <b>SỨC KHỎE TÀI CHÍNH:</b> ${financial.healthStatus} (${financial.healthScore}/5⭐)\n`;
    msg += `  • <b>P/E:</b> ${r.pe}x | <b>ROE:</b> ${r.roe}% | <b>D/E:</b> ${r.deRatio}x\n`;
    msg += `  • <b>Biên LN gộp:</b> ${r.grossMargin}% | <b>Biên LN ròng:</b> ${r.netMargin}%\n\n`;

    msg += `👇 <i>Bấm các nút bên dưới để xem phân tích chi tiết từng chuyên mục:</i>`;

    return msg;
  }

  private buildShortTermReport(
    symbol: string, detail: StockDetail,
    tech: TechnicalIndicators, safeBuy: SafeBuyZone, scenarios: ScenarioModel,
  ): string {
    const price = detail.currentPrice;
    const gainPct = price > 0 ? (((safeBuy.targetShortTerm - price) / price) * 100).toFixed(1) : '0';
    const lossPct = price > 0 ? (((price - safeBuy.stopLoss) / price) * 100).toFixed(1) : '0';

    let msg = `📈 <b>PHÂN TÍCH NGẮN HẠN & TRADING PLAN - MÃ ${symbol}</b>\n\n`;

    // Chỉ báo kỹ thuật chi tiết
    msg += `<b>🔬 1. CHỈ BÁO KỸ THUẬT CHI TIẾT:</b>\n`;
    msg += `  • <b>Giá hiện tại:</b> <code>${price}k</code> (${detail.changePercent > 0 ? '+' : ''}${detail.changePercent}%)\n`;
    msg += `  • <b>MA20:</b> ${tech.ma20}k | <b>MA50:</b> ${tech.ma50}k | <b>MA200:</b> ${tech.ma200}k\n`;
    msg += `  • <b>Vị trí giá vs MA:</b> ${price > tech.ma20 ? '✅ Trên MA20' : '❌ Dưới MA20'} | ${price > tech.ma50 ? '✅ Trên MA50' : '❌ Dưới MA50'} | ${price > tech.ma200 ? '✅ Trên MA200' : '❌ Dưới MA200'}\n`;
    msg += `  • <b>RSI (14):</b> <code>${tech.rsi14}</code> ${tech.rsi14 >= 70 ? '⚠️ Quá mua' : tech.rsi14 <= 30 ? '💡 Quá bán' : '✅ Trung tính'}\n`;
    msg += `  • <b>MACD:</b> Line <code>${tech.macd.macd}</code> | Signal <code>${tech.macd.signal}</code> | Histogram <code>${tech.macd.histogram > 0 ? '▲' : '▼'}${tech.macd.histogram}</code>\n`;
    msg += `  • <b>Bollinger Bands:</b> ${tech.bollingerBands.lower}k ↔ ${tech.bollingerBands.middle}k ↔ ${tech.bollingerBands.upper}k\n`;
    msg += `  • <b>Volume:</b> ${tech.currentVolumeRatio}x trung bình (${tech.currentVolumeRatio >= 1.5 ? '🔥 Cao' : tech.currentVolumeRatio <= 0.5 ? '📉 Thấp' : '📊 Bình thường'})\n\n`;

    // Support / Resistance
    msg += `<b>🔰 2. VÙNG HỖ TRỢ & KHÁNG CỰ:</b>\n`;
    msg += `  • <b>Hỗ trợ:</b> ${tech.support.length > 0 ? tech.support.map(s => `<code>${s}k</code>`).join(' → ') : 'Chưa xác định rõ'}\n`;
    msg += `  • <b>Kháng cự:</b> ${tech.resistance.length > 0 ? tech.resistance.map(r => `<code>${r}k</code>`).join(' → ') : 'Chưa xác định rõ'}\n\n`;

    // Tín hiệu
    msg += `<b>⚡ 3. TÍN HIỆU KỸ THUẬT:</b>\n`;
    tech.signals.forEach(s => { msg += `  ${s}\n`; });
    msg += `\n`;

    // Trading Plan
    msg += `<b>🎯 4. KẾ HOẠCH TRADING NGẮN HẠN (1-4 TUẦN):</b>\n`;
    msg += `  • <b>Giá mua lý tưởng:</b> <code>${safeBuy.idealBuyPrice}k</code>\n`;
    msg += `  • <b>Vùng mua an toàn:</b> <code>${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k</code>\n`;
    msg += `  • <b>Mục tiêu (Target):</b> <code>${safeBuy.targetShortTerm}k</code> (<b>+${gainPct}%</b>)\n`;
    msg += `  • <b>Cắt lỗ (Stop Loss):</b> <code>${safeBuy.stopLoss}k</code> (<b>-${lossPct}%</b>)\n`;
    msg += `  • <b>Tỷ lệ Risk/Reward:</b> <b>1:${safeBuy.riskRewardShort}</b> ${safeBuy.riskRewardShort >= 2 ? '✅ Hấp dẫn' : '⚠️ Chưa tối ưu'}\n`;
    msg += `  • <b>Độ tin cậy:</b> ${safeBuy.confidence === 'HIGH' ? '🟢 CAO' : safeBuy.confidence === 'MEDIUM' ? '🟡 TRUNG BÌNH' : '🔴 THẤP'}\n\n`;

    // Biên ngắn hạn
    msg += `<b>📊 5. BIÊN NGẮN HẠN:</b>\n`;
    msg += `  • <b>Biên lợi nhuận kỳ vọng:</b> <b>+${gainPct}%</b> (${price}k → ${safeBuy.targetShortTerm}k)\n`;
    msg += `  • <b>Rủi ro tối đa:</b> <b>-${lossPct}%</b> (${price}k → ${safeBuy.stopLoss}k)\n\n`;

    // Mô hình dự kiến
    msg += `<b>📈 6. MÔ HÌNH DỰ KIẾN (1-4 TUẦN):</b>\n`;
    msg += `  🟢 Bull: ${scenarios.bullCase.targetPrice}k (+${(((scenarios.bullCase.targetPrice - price) / price) * 100).toFixed(1)}%) - ${scenarios.bullCase.probability}%\n`;
    msg += `  🟡 Base: ${scenarios.baseCase.targetPrice}k (${(((scenarios.baseCase.targetPrice - price) / price) * 100).toFixed(1)}%) - ${scenarios.baseCase.probability}%\n`;
    msg += `  🔴 Bear: ${scenarios.bearCase.targetPrice}k (${(((scenarios.bearCase.targetPrice - price) / price) * 100).toFixed(1)}%) - ${scenarios.bearCase.probability}%\n`;

    // Lý do
    if (safeBuy.reasons.length > 0) {
      msg += `\n<b>💡 LÝ DO:</b>\n`;
      safeBuy.reasons.forEach(r => { msg += `  • ${r}\n`; });
    }

    return msg;
  }

  private buildLongTermReport(
    symbol: string, detail: StockDetail,
    financial: FinancialAnalysis, tech: TechnicalIndicators,
    safeBuy: SafeBuyZone, scenarios: ScenarioModel,
  ): string {
    const r = financial.ratios;
    const price = detail.currentPrice;
    const gainPctLong = price > 0 ? (((safeBuy.targetLongTerm - price) / price) * 100).toFixed(1) : '0';

    let msg = `📊 <b>PHÂN TÍCH DÀI HẠN & BCTC - MÃ ${symbol}</b>\n\n`;

    // Tăng trưởng
    msg += `<b>📈 1. TĂNG TRƯỞNG & CHẤT LƯỢNG LỢI NHUẬN:</b>\n`;
    msg += `  • <b>Tăng trưởng Doanh thu:</b> ${r.revenueGrowth > 0 ? '+' : ''}${r.revenueGrowth}%/năm\n`;
    msg += `  • <b>Tăng trưởng Lợi nhuận ST:</b> <b>${r.profitGrowth > 0 ? '+' : ''}${r.profitGrowth}%/năm</b>\n`;
    msg += `  • <b>Hiệu quả vốn:</b> ROE = <b>${r.roe}%</b> ${r.roe >= 15 ? '✅' : '⚠️'} | ROA = <b>${r.roa}%</b>\n`;
    msg += `  • <b>EPS:</b> ${r.eps.toLocaleString('vi-VN')} VNĐ/CP\n`;
    msg += `  • <b>Biên LN gộp:</b> ${r.grossMargin}% | <b>Biên LN ròng:</b> ${r.netMargin}%\n\n`;

    // Bảng cân đối
    msg += `<b>🏦 2. CƠ CẤU TÀI SẢN & NỢ:</b>\n`;
    msg += `  • <b>Nợ / VCSH (D/E):</b> ${r.deRatio}x (${r.deRatio <= 1.0 ? '✅ An toàn cao' : r.deRatio <= 2.0 ? '⚠️ Đòn bẩy vừa phải' : '🔴 Rủi ro cao'})\n`;
    if (r.revenue > 0) msg += `  • <b>Doanh thu:</b> ${r.revenue.toLocaleString('vi-VN')} Tỷ VNĐ\n`;
    if (r.netProfit > 0) msg += `  • <b>Lợi nhuận ròng:</b> ${r.netProfit.toLocaleString('vi-VN')} Tỷ VNĐ\n`;
    msg += `  • <b>Sức khỏe tài chính:</b> ${financial.healthStatus} (${financial.healthScore}/5⭐)\n\n`;

    // Biên dài hạn
    msg += `<b>🎯 3. BIÊN DÀI HẠN (3-12 THÁNG):</b>\n`;
    msg += `  • <b>Mục tiêu dài hạn:</b> <code>${safeBuy.targetLongTerm}k</code> (<b>+${gainPctLong}%</b>)\n`;
    msg += `  • <b>R/R dài hạn:</b> 1:${safeBuy.riskRewardLong}\n`;
    msg += `  • <b>Định giá:</b> ${financial.valuationStatus === 'CHEAP' ? '🟢 Hấp dẫn' : financial.valuationStatus === 'EXPENSIVE' ? '🔴 Đắt' : '🟡 Hợp lý'}\n\n`;

    // Xu hướng dài hạn trên chart
    msg += `<b>📉 4. XU HƯỚNG DÀI HẠN TRÊN ĐỒ THỊ:</b>\n`;
    msg += `  • <b>MA200:</b> ${tech.ma200}k - Giá ${price > tech.ma200 ? '✅ trên' : '❌ dưới'} MA200\n`;
    msg += `  • <b>Xu hướng:</b> ${tech.trend} (${tech.trendStrength})\n\n`;

    // Kịch bản dài hạn
    msg += `<b>🔮 5. KỊCH BẢN DÀI HẠN:</b>\n`;
    msg += `  🟢 <b>Tích cực:</b> ${scenarios.bullCase.description}\n`;
    msg += `  🟡 <b>Trung lập:</b> ${scenarios.baseCase.description}\n`;
    msg += `  🔴 <b>Tiêu cực:</b> ${scenarios.bearCase.description}\n`;

    return msg;
  }

  private buildValuationReport(
    symbol: string, detail: StockDetail,
    financial: FinancialAnalysis, tech: TechnicalIndicators,
  ): string {
    const r = financial.ratios;

    let msg = `💎 <b>ĐỊNH GIÁ & LỢI THẾ CẠNH TRANH (MOAT) - MÃ ${symbol}</b>\n\n`;

    msg += `<b>📊 1. CHỈ SỐ ĐỊNH GIÁ:</b>\n`;
    msg += `  • <b>P/E:</b> <b>${r.pe} lần</b> ${r.pe > 0 && r.pe < 12 ? '🟢 Rẻ' : r.pe > 25 ? '🔴 Cao' : '🟡 Hợp lý'}\n`;
    msg += `  • <b>P/B:</b> <b>${r.pb} lần</b> ${r.pb > 0 && r.pb < 1.5 ? '🟢 Dưới giá trị sổ sách' : r.pb > 4 ? '🔴 Cao' : '🟡 Hợp lý'}\n`;
    msg += `  • <b>EPS:</b> ${r.eps.toLocaleString('vi-VN')} VNĐ/CP\n`;
    msg += `  • <b>Đánh giá định giá:</b> ${financial.valuationStatus === 'CHEAP' ? '🟢 HẤP DẪN - Vùng tích lũy dài hạn' : financial.valuationStatus === 'EXPENSIVE' ? '🔴 ĐẮNG - Cẩn trọng áp lực điều chỉnh' : '🟡 HỢP LÝ - Giá phản ánh tiềm năng'}\n\n`;

    msg += `<b>🛡️ 2. LỢI THẾ CẠNH TRANH (ECONOMIC MOAT):</b>\n`;
    if (r.roe >= 15 && r.grossMargin >= 20) {
      msg += `  • <b>Moat:</b> 🟢 MẠNH - ROE ${r.roe}% + Biên gộp ${r.grossMargin}% cho thấy lợi thế cạnh tranh rõ ràng\n`;
    } else if (r.roe >= 10) {
      msg += `  • <b>Moat:</b> 🟡 TRUNG BÌNH - ROE ${r.roe}%, cần theo dõi cải thiện biên\n`;
    } else {
      msg += `  • <b>Moat:</b> 🔴 YẾU - ROE thấp ${r.roe}%, chưa thể hiện rõ lợi thế\n`;
    }
    msg += `  • <b>Khả năng sinh lời:</b> ROE ${r.roe}% | ROA ${r.roa}%\n`;
    msg += `  • <b>Biên LN gộp:</b> ${r.grossMargin}% | <b>Biên LN ròng:</b> ${r.netMargin}%\n`;
    msg += `  • <b>Nợ/Vốn CSH:</b> ${r.deRatio}x\n\n`;

    msg += `<b>👔 3. BAN LÃNH ĐẠO & CỔ TỨC:</b>\n`;
    msg += `  • <b>Sức khỏe tổng thể:</b> ${financial.healthStatus} (${financial.healthScore}/5)\n`;
    msg += `  • <b>Đánh giá:</b> ${financial.recommendation}\n`;

    return msg;
  }

  private buildCatalystReport(
    symbol: string, detail: StockDetail,
    financial: FinancialAnalysis, tech: TechnicalIndicators,
    news: NewsArticle[],
  ): string {
    const r = financial.ratios;

    let msg = `🚀 <b>NGÀNH, VĨ MÔ & CATALYST - MÃ ${symbol}</b>\n\n`;

    msg += `<b>🌍 1. CHU KỲ NGÀNH & MÔI TRƯỜNG VĨ MÔ:</b>\n`;
    msg += `  • <b>Tăng trưởng doanh thu:</b> ${r.revenueGrowth > 0 ? '+' : ''}${r.revenueGrowth}% (${r.revenueGrowth > 10 ? '🟢 Ngành mở rộng' : r.revenueGrowth > 0 ? '🟡 Ổn định' : '🔴 Thu hẹp'})\n`;
    msg += `  • <b>Dòng tiền thị trường:</b> ${detail.flowTrend === 'BULLISH' ? '🟢 Tích cực - Dòng tiền chảy vào' : detail.flowTrend === 'BEARISH' ? '🔴 Tiêu cực - Dòng tiền rút ra' : '🟡 Cân bằng'}\n`;
    msg += `  • <b>Khối ngoại:</b> ${detail.foreignNetBuyVolume >= 0 ? '🟢 Mua ròng' : '🔴 Bán ròng'} ${Math.abs(detail.foreignNetBuyVolume).toLocaleString('vi-VN')} CP\n\n`;

    msg += `<b>💡 2. ĐỘNG LỰC TĂNG GIÁ CHÍNH (CATALYSTS):</b>\n`;
    if (r.profitGrowth > 10) msg += `  • 📈 Tăng trưởng lợi nhuận mạnh +${r.profitGrowth}%\n`;
    if (r.roe >= 15) msg += `  • 💎 Hiệu quả sinh lời cao (ROE ${r.roe}%)\n`;
    if (tech.trend === 'UPTREND') msg += `  • 🔥 Xu hướng kỹ thuật tăng (${tech.trendStrength})\n`;
    if (tech.currentVolumeRatio >= 1.5) msg += `  • 📊 Volume giao dịch đột biến (${tech.currentVolumeRatio}x)\n`;
    if (detail.flowTrend === 'BULLISH') msg += `  • 💵 Dòng tiền mua ròng chủ động mạnh\n`;
    msg += `\n`;

    if (news && news.length > 0) {
      msg += `<b>📰 3. TIN TỨC HỖ TRỢ:</b>\n`;
      news.slice(0, 3).forEach((n, i) => {
        msg += `  ${i + 1}. ${n.title.slice(0, 80)}...\n`;
      });
      msg += `\n`;
    }

    // Rủi ro
    msg += `<b>⚠️ 4. RỦI RO CẦN LƯU Ý:</b>\n`;
    if (tech.rsi14 >= 70) msg += `  • RSI quá mua (${tech.rsi14}) - Cẩn trọng đỉnh ngắn hạn\n`;
    if (r.deRatio > 1.5) msg += `  • Đòn bẩy nợ cao (D/E = ${r.deRatio}x)\n`;
    if (r.profitGrowth < 0) msg += `  • Lợi nhuận suy giảm (${r.profitGrowth}%)\n`;
    if (tech.trend === 'DOWNTREND') msg += `  • Xu hướng kỹ thuật giảm\n`;
    if (detail.flowTrend === 'BEARISH') msg += `  • Dòng tiền tiêu cực - áp lực bán\n`;

    return msg;
  }

  /**
   * Lọc và làm sạch chuỗi HTML hợp lệ cho Telegram API
   */
  private sanitizeHtmlForTelegram(text: string): string {
    let clean = text
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      .replace(/### (.*?)\n/g, '<b>$1</b>\n')
      .replace(/## (.*?)\n/g, '<b>$1</b>\n')
      .replace(/# (.*?)\n/g, '<b>$1</b>\n');

    return clean;
  }
}
