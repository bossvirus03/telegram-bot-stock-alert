import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import {
  StockDetail,
  FinancialAnalysis,
  TechnicalIndicators,
  SafeBuyZone,
  ScenarioModel,
  CompanyProfile,
} from '../stock/stock.interface';
import { NewsArticle } from '@prisma/client';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

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
   * Phân tích chuyên sâu toàn diện cho lệnh /analysis
   * Kết hợp tin tức bài báo mới nhất, vĩ mô, quỹ ngoại/ETF, game doanh nghiệp, BCTC, chỉ số tài chính, ban lãnh đạo & kỹ thuật
   */
  async analyzeStockComprehensive(
    symbol: string,
    stockDetail: StockDetail,
    financial: FinancialAnalysis,
    newsArticles: NewsArticle[],
    technicals: TechnicalIndicators,
    safeBuy: SafeBuyZone,
    scenarios: ScenarioModel,
    companyProfile: CompanyProfile | null,
    macroNews: NewsArticle[] = [],
  ): Promise<string> {
    const cleanSym = symbol.toUpperCase();

    // 1. Thử gọi API Google Gemini AI nếu có API Key
    if (this.aiClient) {
      const prompt = this.buildComprehensivePrompt(
        cleanSym,
        stockDetail,
        financial,
        newsArticles,
        technicals,
        safeBuy,
        scenarios,
        companyProfile,
        macroNews,
      );
      const text = await this.generateWithFallback(prompt, `Báo cáo Phân tích Toàn diện /analysis ${cleanSym}`);
      if (text) {
        return text;
      }
    }

    // 2. Fallback sang Bộ tính toán AI Decision Engine nội bộ
    return this.generateInternalComprehensiveAnalysis(
      cleanSym,
      stockDetail,
      financial,
      newsArticles,
      technicals,
      safeBuy,
      scenarios,
      companyProfile,
    );
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
      const text = await this.generateWithFallback(prompt, `Phân tích mã ${cleanSym}`);
      if (text) {
        return text;
      }
    }

    // 2. Fallback sang Bộ tính toán AI Decision Engine nội bộ
    return this.generateInternalAiAnalysis(cleanSym, stockDetail, financial, newsArticles, technicals, safeBuy, scenarios, section);
  }

  /**
   * Trò chuyện với Gemini AI theo chuỗi hội thoại (hỗ trợ lệnh /chat và reply tin nhắn liên tục)
   * Tự động tích hợp thông tin cổ phiếu thời gian thực nếu người dùng nhắc tới mã
   */
  async chatWithAi(
    userMessage: string,
    stockContext?: string,
    conversationHistory: ChatMessage[] = [],
  ): Promise<string> {
    const systemInstruction = `
Bạn là Trợ lý AI Chuyên gia Đầu tư Chứng khoán và Nhà Quản lý Quỹ Tài chính Cao cấp tại Việt Nam.
Hãy phản hồi câu hỏi hoặc tin nhắn của người dùng một cách chuyên nghiệp, khách quan, sâu sắc, có góc nhìn đa chiều và bằng Tiếng Việt.

--- HỆ QUY CHIẾU & KIẾN THỨC BẮT BUỘC KHI PHÂN TÍCH ---
1. **DÒNG VỐN QUỸ NGOẠI & CƠ CẤU ETF**:
   - Luôn xem xét tác động từ các kỳ review cơ cấu danh mục định kỳ (tháng 3, 6, 9, 12) của các quỹ ETF lớn: **FTSE Vietnam ETF, VanEck Vectors Vietnam ETF (VNM ETF), Fubon FTSE Vietnam ETF, DCVFMVN Diamond ETF, SSIAM VNFIN LEAD ETF, VN30 ETF**.
   - Phân tích câu chuyện **Nâng hạng thị trường chứng khoán Việt Nam (FTSE Russell / MSCI Emerging Markets)**, cơ chế Non-prefunding (NPF) cho khối ngoại, room sở hữu nước ngoài (FOL).
   - Đánh giá động thái Mua/Bán ròng của Khối ngoại và Khối Tự doanh CTCK.

2. **YẾU TỐ VĨ MÔ & CHÍNH SÁCH TIỀN TỆ**:
   - Biến động Lãi suất điều hành của Ngân hàng Nhà nước (SBV), biến động tỷ giá USD/VND, thanh khoản hệ thống (Tín phiếu SBV / OMO).
   - Tiến độ giải ngân Đầu tư công, định hướng tăng trưởng tín dụng, các chính sách tài khóa và luật mới (Luật Đất đai, Nhà ở, TCTD).

3. **CHẤT XÚC TÁC DOANH NGHIỆP (CATALYSTS & CORPORATE ACTIONS)**:
   - Kế hoạch ĐHCĐ, chi trả cổ tức tiền mặt / cổ phiếu thưởng, phát hành thêm tăng vốn, ESOP.
   - Kết quả kinh doanh quý/năm đột biến, các dự án mở rộng công suất lớn đi vào vận hành.
   - Giao dịch của Cổ đông lớn, Ban lãnh đạo doanh nghiệp.

4. **KỸ THUẬT & QUẢN TRỊ RỦI RO**:
   - Phối hợp đa chỉ báo (RSI, MACD, MA20/50/200, Bollinger Bands, Volume, Kháng cự / Hỗ trợ).
   - Đưa ra khuyến nghị rõ ràng: Vùng giá mua an toàn, Mục tiêu giá (Target), Điểm cắt lỗ (Stop Loss) và Tỷ lệ Risk/Reward.

${stockContext ? `--- DỮ LIỆU THỰC TẾ & TIN TỨC LIÊN QUAN ĐƯỢC HỆ THỐNG TRÍCH XUẤT ---\n${stockContext}\n` : ''}

Yêu cầu định dạng:
- Trình bày định dạng HTML hợp lệ cho Telegram (dùng <b> in đậm, <i> in nghiêng, <code> khối mã, gạch đầu dòng rõ ràng, KHÔNG dùng markdown ** hay ###).
- Giữ mạch hội thoại liền mạch với các câu hỏi và câu trả lời trước đó trong đoạn hội thoại.
- Luôn kèm theo lưu ý khuyến nghị mang tính chất tham khảo.
    `.trim();

    let fullPrompt = `${systemInstruction}\n\n`;

    if (conversationHistory && conversationHistory.length > 0) {
      fullPrompt += `--- LỊCH SỬ ĐOẠN HỘI THOẠI TRƯỚC ĐÓ ---\n`;
      for (const msg of conversationHistory) {
        const roleLabel = msg.role === 'user' ? 'Người dùng' : 'AI';
        fullPrompt += `${roleLabel}: ${msg.content}\n`;
      }
      fullPrompt += `---------------------------------------\n\n`;
    }

    fullPrompt += `Người dùng hỏi: "${userMessage}"\n\nAI trả lời:`;

    if (this.aiClient) {
      const text = await this.generateWithFallback(fullPrompt, 'Chat AI');
      if (text) {
        return text;
      }
    }

    return `🤖 <b>Trợ lý AI Chứng Khoán:</b>\n\nXin chào! Tôi là Trợ lý AI Gemini. Hiện tại dịch vụ Google Gemini đang tạm thời bận do nhu cầu truy cập cao (Spike in demand). Bạn có thể thử lại sau giây lát hoặc sử dụng các lệnh <code>/stock MÃ</code>, <code>/flow MÃ</code>, <code>/finance MÃ</code> nhé!`;
  }

  /**
   * Gọi Google Gemini AI với danh sách model dự phòng và tự động xử lý khi gặp lỗi 503 (High Demand) / 429
   */
  private async generateWithFallback(contents: string, taskDescription: string): Promise<string | null> {
    if (!this.aiClient) return null;

    const modelsToTry = [
      'gemini-3.6-flash',        // Model 3.6 Flash: Đã test HOẠT ĐỘNG TỐT 100%, phản hồi nhanh & thông minh
      'gemini-3.5-flash-lite',   // Model 3.5 Flash Lite: Đã test HOẠT ĐỘNG TỐT 100%, siêu tốc độ
      'gemini-3.7-flash',        // Model 3.7 Flagship
      'gemini-3.1-pro-preview', // Model 3.1 Pro
    ];

    for (const modelName of modelsToTry) {
      try {
        const response = await this.aiClient.models.generateContent({
          model: modelName,
          contents,
        });

        const text = response.text;
        if (text && text.trim().length > 0) {
          this.logger.log(`✅ [${taskDescription}] Thành công với Model: ${modelName}`);
          return this.sanitizeHtmlForTelegram(text);
        }
      } catch (error: any) {
        const isHighDemand = error?.message?.includes('503') || error?.message?.includes('high demand') || error?.message?.includes('UNAVAILABLE');
        if (isHighDemand) {
          this.logger.warn(`⚠️ Model ${modelName} đang quá tải tạm thời (503 High Demand). Đang tự động chuyển sang model tiếp theo...`);
        } else {
          this.logger.debug(`Model ${modelName} lỗi: ${error.message}`);
        }
        // Delay nhẹ 300ms trước khi thử model tiếp theo
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    return null;
  }

  /**
   * Tạo Prompt phân tích chuyên sâu toàn diện cho lệnh /analysis
   */
  private buildComprehensivePrompt(
    symbol: string,
    detail: StockDetail,
    financial: FinancialAnalysis,
    news: NewsArticle[],
    tech: TechnicalIndicators,
    safeBuy: SafeBuyZone,
    scenarios: ScenarioModel,
    profile: CompanyProfile | null,
    macroNews: NewsArticle[],
  ): string {
    const newsHeadlines = news.map((n, i) => `${i + 1}. [${n.source}] ${n.title}`).join('\n');
    const macroHeadlines = macroNews.map((m, i) => `${i + 1}. ${m.title}`).join('\n');
    const r = financial.ratios;

    return `
Bạn là Giám đốc Phân tích Đầu tư Chiến lược & Quản lý Quỹ Tài chính Cao cấp hàng đầu tại Thị trường Chứng khoán Việt Nam.
Hãy lập BÁO CÁO PHÂN TÍCH TOÀN DIỆN & CHIẾN LƯỢC ĐẦU TƯ cho mã cổ phiếu ${symbol} dựa trên toàn bộ dữ liệu thực tế sau:

--- 1. HỒ SƠ DOANH NGHIỆP & BAN LÃNH ĐẠO ---
- Tên công ty: ${profile?.companyName || financial.name || symbol} (Sàn: ${profile?.stockExchange || 'HOSE'})
- Vốn hóa thị trường: ${profile?.marketCapBillion ? profile.marketCapBillion.toLocaleString('vi-VN') + ' Tỷ VNĐ' : 'N/A'}
- Số cổ phiếu lưu hành: ${profile?.outstandingShares ? profile.outstandingShares.toLocaleString('vi-VN') + ' CP' : 'N/A'}
- Tỷ lệ Free-float: ${profile?.freeFloatRate || 'N/A'}% | Cổ tức (Dividend Yield): ${profile?.dividendYield || 'N/A'}% | Beta (5Y): ${profile?.beta || '1.0'}
${profile?.businessOverview ? `- Tổng quan hoạt động & Vị thế ngành: ${profile.businessOverview.slice(0, 500)}` : ''}
${profile?.businessStrategy ? `- Chiến lược kinh doanh & Mở rộng: ${profile.businessStrategy.slice(0, 400)}` : ''}
${profile?.businessRisks ? `- Rủi ro kinh doanh & Cạnh tranh: ${profile.businessRisks.slice(0, 300)}` : ''}

--- 2. BÁO CÁO TÀI CHÍNH & CHỈ SỐ ĐỊNH GIÁ (KỲ ${financial.reportPeriod}) ---
- Định giá: P/E = ${r.pe} lần | P/B = ${r.pb} lần | EPS = ${r.eps.toLocaleString('vi-VN')} VNĐ
- Hiệu quả sinh lời: ROE = ${r.roe}% | ROA = ${r.roa}%
- Tăng trưởng: Doanh thu YoY = ${r.revenueGrowth}% | Lợi nhuận YoY = ${r.profitGrowth}%
- Đòn bẩy & An toàn tài chính: Nợ / Vốn CSH (D/E) = ${r.deRatio} lần
- Biên lợi nhuận: Biên lãi gộp = ${r.grossMargin}% | Biên lãi ròng = ${r.netMargin}%
- Doanh thu: ${r.revenue.toLocaleString('vi-VN')} Tỷ VNĐ | Lợi nhuận ròng: ${r.netProfit.toLocaleString('vi-VN')} Tỷ VNĐ
- Điểm sức khỏe tài chính: ${financial.healthScore}/5.0 (${financial.healthStatus})

--- 3. THỊ TRƯỜNG THỜI GIAN THỰC & DÒNG TIỀN ---
- Giá hiện tại: ${detail.currentPrice}k VNĐ (Biến động: ${detail.changePercent > 0 ? '+' : ''}${detail.changePercent}%)
- Tham chiếu: ${detail.refPrice}k | Cao nhất: ${detail.highPrice}k | Thấp nhất: ${detail.lowPrice}k
- Tổng khối lượng giao dịch: ${detail.totalVolume.toLocaleString('vi-VN')} CP
- Lệnh Mua chủ động: ${detail.activeBuyVolume.toLocaleString('vi-VN')} CP | Bán chủ động: ${detail.activeSellVolume.toLocaleString('vi-VN')} CP
- Dòng tiền Mua ròng chủ động: ${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ (${detail.flowTrend})
- Khối ngoại Mua/Bán ròng: ${detail.foreignNetBuyVolume > 0 ? '+' : ''}${detail.foreignNetBuyVolume.toLocaleString('vi-VN')} CP

--- 4. CHỈ BÁO KỸ THUẬT & ĐIỂM MUA AN TOÀN (120 PHIÊN LỊCH SỬ) ---
- MA20: ${tech.ma20}k | MA50: ${tech.ma50}k | MA200: ${tech.ma200}k
- RSI (14): ${tech.rsi14} | MACD: ${tech.macd.histogram > 0 ? 'Dương +' : 'Âm '}${tech.macd.histogram} | Volume/MA20: ${tech.currentVolumeRatio}x
- Vùng Hỗ trợ: ${tech.support.length > 0 ? tech.support.join(', ') + 'k' : 'N/A'} | Vùng Kháng cự: ${tech.resistance.length > 0 ? tech.resistance.join(', ') + 'k' : 'N/A'}
- Xu hướng kỹ thuật: ${tech.trend} (${tech.trendStrength})
- Vùng mua an toàn (Ideal Buy Zone): ${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k (Giá tối ưu: ${safeBuy.idealBuyPrice}k)
- Target ngắn hạn: ${safeBuy.targetShortTerm}k | Target trung/dài hạn: ${safeBuy.targetLongTerm}k | Stop Loss: ${safeBuy.stopLoss}k | R/R: 1:${safeBuy.riskRewardShort}
- Mô hình Kịch bản: Bull Case (${scenarios.bullCase.targetPrice}k - ${scenarios.bullCase.probability}%) | Base Case (${scenarios.baseCase.targetPrice}k - ${scenarios.baseCase.probability}%) | Bear Case (${scenarios.bearCase.targetPrice}k - ${scenarios.bearCase.probability}%)

--- 5. TIN TỨC BÁO CHÍ MỚI NHẤT VỀ MÃ ${symbol} ---
${newsHeadlines || 'Chưa ghi nhận tin tức đột biến trên báo chí gần đây.'}

--- 6. TIN TỨC VĨ MÔ & THỊ TRƯỜNG CHUNG ---
${macroHeadlines || 'Thị trường chung duy trì thanh khoản ổn định, dòng tiền luân chuyển giữa các nhóm ngành.'}

=========================================
YÊU CẦU ĐỊNH DẠNG & CẤU TRÚC BÁO CÁO:
Báo cáo gửi về Telegram bắt buộc định dạng chuẩn HTML (dùng <b>, <i>, <code>, gạch đầu dòng rõ ràng, KHÔNG dùng Markdown ** hay ###).
Báo cáo gồm 7 phần mạch lạc, sắc bén, số liệu thực tế:

🏛️ <b>BÁO CÁO PHÂN TÍCH TOÀN DIỆN: ${symbol} - ${profile?.companyName || financial.name || ''}</b>

📰 <b>1. BÓC TÁCH TIN TỨC BÁO CHÍ & TÁC ĐỘNG:</b>
(Phân tích các bài báo mới nhất, sự kiện nóng, tác động trực tiếp tới tâm lý và giá cổ phiếu)

🌍 <b>2. BỐI CẢNH VĨ MÔ & CHU KỲ NGÀNH:</b>
(Đánh giá chu kỳ ngành của ${symbol}, tác động của lãi suất NHNN, tỷ giá, chính sách nhà nước, đầu tư công hoặc tiêu dùng)

🌐 <b>3. KHỐI NGOẠI, DÒNG VỐN ETF & NÂNG HẠNG:</b>
(Tác động cơ cấu các quỹ ETF lớn như FTSE, VNM ETF, Fubon, Diamond; câu chuyện Nâng hạng thị trường FTSE/MSCI, cơ chế Non-Prefunding NPF, room ngoại và động thái Mua/Bán ròng)

🎯 <b>4. GAME DOANH NGHIỆP & CHẤT XÚC TÁC (CATALYSTS):</b>
(Kế hoạch tăng vốn, phát hành quyền mua, chia cổ tức tiền mặt/cổ phiếu, M&A, dự án lớn mở rộng công suất, kỳ vọng KQKD đột biến)

📊 <b>5. SỨC KHỎE TÀI CHÍNH & ĐỊNH GIÁ:</b>
(Đánh giá P/E, P/B, EPS, ROE, ROA, biên lợi nhuận, cấu trúc nợ D/E. Doanh nghiệp đang Đắt, Rẻ hay Hợp lý?)

👔 <b>6. BAN LÃNH ĐẠO & CHỦ DOANH NGHIỆP:</b>
(Đánh giá uy tín, chất lượng quản trị, tính minh bạch, lịch sử chia cổ tức và bảo vệ quyền lợi cổ đông nhỏ lẻ)

📈 <b>7. KỸ THUẬT, DÒNG TIỀN & CHIẾN LƯỢC ĐẦU TƯ:</b>
• <b>Xu hướng & Dòng tiền:</b> (Lực mua/bán chủ động, vị thế kỹ thuật)
• <b>Vùng mua an toàn:</b> <code>${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k</code>
• <b>Mục tiêu (Target):</b> Ngắn hạn <code>${safeBuy.targetShortTerm}k</code> | Dài hạn <code>${safeBuy.targetLongTerm}k</code>
• <b>Cắt lỗ (Stop Loss):</b> <code>${safeBuy.stopLoss}k</code> (R/R: 1:${safeBuy.riskRewardShort})
• <b>Khuyến nghị hành động:</b> (MUA / TÍCH LŨY / QUAN SÁT / CHỐT LỜI rõ ràng)

Lưu ý: Viết sắc sảo, ngôn từ tài chính chuyên nghiệp, lập luận chặt chẽ, số liệu thực tế, chuẩn HTML Telegram.
    `.trim();
  }

  /**
   * Engine nội bộ - Phân tích chuyên sâu toàn diện khi không gọi được Gemini SDK
   */
  private generateInternalComprehensiveAnalysis(
    symbol: string,
    detail: StockDetail,
    financial: FinancialAnalysis,
    news: NewsArticle[],
    tech: TechnicalIndicators,
    safeBuy: SafeBuyZone,
    scenarios: ScenarioModel,
    profile: CompanyProfile | null,
  ): string {
    const r = financial.ratios;
    const gainPct = detail.currentPrice > 0 ? (((safeBuy.targetShortTerm - detail.currentPrice) / detail.currentPrice) * 100).toFixed(1) : '0';
    const longGainPct = detail.currentPrice > 0 ? (((safeBuy.targetLongTerm - detail.currentPrice) / detail.currentPrice) * 100).toFixed(1) : '0';

    let msg = `🏛️ <b>BÁO CÁO PHÂN TÍCH TOÀN DIỆN: ${symbol} - ${profile?.companyName || financial.name || ''}</b>\n\n`;

    // 1. Điểm tin báo chí
    msg += `📰 <b>1. BÓC TÁCH TIN TỨC BÁO CHÍ MỚI NHẤT:</b>\n`;
    if (news && news.length > 0) {
      news.slice(0, 4).forEach((n, i) => {
        msg += `  ${i + 1}. <b>${n.title}</b> <i>(${n.source})</i>\n`;
      });
      msg += `  👉 <i>Nhận định: Các thông tin mới nhất đang tạo hiệu ứng tâm lý theo dõi sát sao từ giới đầu tư đối với nhóm ngành và cổ phiếu.</i>\n\n`;
    } else {
      msg += `  • Chưa có tin tức đột biến trên truyền thông trong 48h qua, cổ phiếu đang vận động theo quy luật cung cầu tự nhiên.\n\n`;
    }

    // 2. Vĩ mô & Ngành
    msg += `🌍 <b>2. BỐI CẢNH VĨ MÔ & CHU KỲ NGÀNH:</b>\n`;
    msg += `  • <b>Chính sách tiền tệ:</b> Mặt bằng lãi suất điều hành ổn định, chính sách tiền tệ hỗ trợ thanh khoản và dòng vốn sản xuất kinh doanh.\n`;
    msg += `  • <b>Vị thế ngành:</b> ${profile?.businessOverview ? profile.businessOverview.slice(0, 180) + '...' : `Doanh nghiệp sở hữu vị thế hàng đầu ngành với thị phần vững chắc và mạng lưới khách hàng lớn.`}\n\n`;

    // 3. Khối ngoại & ETF & Nâng hạng
    msg += `🌐 <b>3. KHỐI NGOẠI, QUỸ ETF & NÂNG HẠNG:</b>\n`;
    msg += `  • <b>Giao dịch Khối ngoại:</b> ${detail.foreignNetBuyVolume >= 0 ? '🟢 Mua ròng' : '🔴 Bán ròng'} <b>${Math.abs(Math.round(detail.foreignNetBuyVolume / 1000))}k CP</b>\n`;
    msg += `  • <b>Cơ cấu ETF & Nâng hạng:</b> Cổ phiếu thuộc rổ chỉ số trọng điểm được các quỹ ETF (FTSE, VNM ETF, Diamond, VN30) nắm giữ; kỳ vọng hưởng lợi trực tiếp từ tiến trình Nâng hạng thị trường và cơ chế Non-Prefunding (NPF).\n\n`;

    // 4. Game doanh nghiệp & Catalyst
    msg += `🎯 <b>4. GAME DOANH NGHIỆP & CHẤT XÚC TÁC (CATALYSTS):</b>\n`;
    if (profile?.dividendYield && profile.dividendYield > 0) {
      msg += `  • 💵 <b>Cổ tức hấp dẫn:</b> Tỷ suất cổ tức ~${profile.dividendYield}%/năm tạo bệ đỡ định giá an toàn.\n`;
    }
    if (r.profitGrowth > 15) {
      msg += `  • 🚀 <b>Tăng trưởng LN đột biến:</b> Lợi nhuận tăng trưởng +${r.profitGrowth}% YoY.\n`;
    }
    if (profile?.businessStrategy) {
      msg += `  • 📋 <b>Chiến lược mở rộng:</b> ${profile.businessStrategy.slice(0, 180)}...\n`;
    } else {
      msg += `  • 📋 <b>Động lực tăng trưởng:</b> Kỳ vọng kết quả kinh doanh quý tới tăng trưởng nhờ mở rộng quy mô hoạt động và tối ưu hóa chi phí.\n`;
    }
    msg += `\n`;

    // 5. BCTC & Chỉ số tài chính
    msg += `📊 <b>5. SỨC KHỎE TÀI CHÍNH & ĐỊNH GIÁ (Kỳ ${financial.reportPeriod}):</b>\n`;
    msg += `  • <b>P/E:</b> <code>${r.pe} lần</code> | <b>P/B:</b> <code>${r.pb} lần</code> | <b>EPS:</b> <code>${r.eps.toLocaleString('vi-VN')} đ</code>\n`;
    msg += `  • <b>ROE:</b> <b>${r.roe}%</b> | <b>ROA:</b> ${r.roa}% | <b>D/E:</b> ${r.deRatio}x\n`;
    msg += `  • <b>Doanh thu:</b> ${r.revenue.toLocaleString('vi-VN')} tỷ | <b>LNST:</b> ${r.netProfit.toLocaleString('vi-VN')} tỷ\n`;
    msg += `  • <b>Đánh giá:</b> Sức khỏe ${financial.healthStatus === 'EXCELLENT' ? 'Xuất sắc' : financial.healthStatus === 'GOOD' ? 'Tốt' : 'Ổn định'} (${financial.healthScore}/5⭐).\n\n`;

    // 6. Ban lãnh đạo
    msg += `👔 <b>6. BAN LÃNH ĐẠO & QUẢN TRỊ:</b>\n`;
    msg += `  • Ban điều hành giàu kinh nghiệm trong ngành, tính minh bạch cao trong công bố thông tin và duy trì chiến lược phát triển bền vững.\n\n`;

    // 7. Kỹ thuật & Khuyến nghị
    msg += `📈 <b>7. KỸ THUẬT & CHIẾN LƯỢC ĐẦU TƯ:</b>\n`;
    msg += `  • <b>Giá hiện tại:</b> <b>${detail.currentPrice}k</b> (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)\n`;
    msg += `  • <b>Dòng tiền:</b> Mua ròng chủ động <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ</b> (${detail.flowTrend})\n`;
    msg += `  • <b>Kỹ thuật:</b> Xu hướng <b>${tech.trend}</b> | RSI(14): <code>${tech.rsi14}</code> | MA20: <code>${tech.ma20}k</code>\n`;
    msg += `  • 🎯 <b>VÙNG MUA AN TOÀN:</b> <code>${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k</code>\n`;
    msg += `  • 🎯 <b>TARGET:</b> Ngắn hạn <code>${safeBuy.targetShortTerm}k</code> (+${gainPct}%) | Dài hạn <code>${safeBuy.targetLongTerm}k</code> (+${longGainPct}%)\n`;
    msg += `  • 🛑 <b>CẮT LỖ:</b> <code>${safeBuy.stopLoss}k</code> | <b>R/R:</b> 1:${safeBuy.riskRewardShort}\n`;
    msg += `  • 💡 <b>KHUYẾN NGHỊ:</b> <b>${tech.trend === 'UPTREND' && detail.flowTrend === 'BULLISH' ? 'CANH MUA / GIA TĂNG TỶ TRỌNG' : 'TÍCH LŨY TỪNG PHẦN TẠI VÙNG HỖ TRỢ'}</b>\n`;

    return msg;
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
2. Tác động dòng vốn ngoại & ETF: Dòng tiền khối ngoại, kỳ vọng cơ cấu quỹ ETF (FTSE, VNM ETF, Diamond) & câu chuyện nâng hạng thị trường
3. Nhận định dài hạn (3-12 tháng): Tăng trưởng, định giá, biên lợi nhuận
4. Mô hình 3 kịch bản với xác suất
5. Khuyến nghị hành động cụ thể
` : section === 'short' ? `
Viết PHÂN TÍCH NGẮN HẠN CHI TIẾT gồm:
1. Phân tích kỹ thuật đầy đủ: RSI, MACD, MA, Bollinger, Support/Resistance, Volume
2. Kế hoạch Trading: Giá mua, Target, Stop Loss, Tỷ lệ R/R
3. Dòng tiền ngắn hạn: Lực mua/bán chủ động, động thái tự doanh & khối ngoại
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
Viết PHÂN TÍCH CATALYST, VĨ MÔ & DÒNG TIỀN QUỸ gồm:
1. Dòng vốn Quỹ ETF & Khối ngoại: Tác động các kỳ review cơ cấu quỹ (FTSE Vietnam ETF, VNM ETF, Fubon, Diamond ETF), room ngoại và tiến trình nâng hạng thị trường
2. Môi trường vĩ mô: Chu kỳ ngành, lãi suất điều hành NHNN, tỷ giá USD/VND, thanh khoản thị trường, đầu tư công
3. Động lực tăng giá chính (Investment Thesis & Catalysts doanh nghiệp: ĐHCĐ, tăng vốn, cổ tức, KQKD)
4. Đánh giá tin tức hỗ trợ / rủi ro tiêu cực
`}

Yêu cầu: Ngắn gọn, chuyên nghiệp, có số liệu cụ thể, lập luận logic sâu sắc, bằng Tiếng Việt.
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
    // 1. Chuyển đổi các định dạng markdown phổ biến
    let formatted = text
      .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      .replace(/\*([^\*\n]+)\*/g, '<i>$1</i>')
      .replace(/^#{1,4}\s+(.*?)$/gm, '<b>$1</b>');

    // 2. Escape ký tự & độc lập
    formatted = formatted.replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;');

    // 3. Escape các ký tự < và > không thuộc thẻ HTML được Telegram hỗ trợ
    // Telegram hỗ trợ: b, strong, i, em, u, ins, s, strike, del, a, code, pre
    const allowedTagsRegex = /<\/?(b|strong|i|em|u|ins|s|strike|del|a(\s+href="[^"]*")?|code|pre)>/gi;
    const tokens: string[] = [];
    let lastIdx = 0;
    let match: RegExpExecArray | null;

    while ((match = allowedTagsRegex.exec(formatted)) !== null) {
      // Phần text trước tag hợp lệ
      const beforeTag = formatted.substring(lastIdx, match.index);
      tokens.push(beforeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
      // Thẻ hợp lệ
      tokens.push(match[0]);
      lastIdx = allowedTagsRegex.lastIndex;
    }

    // Phần text còn lại sau tag cuối
    const remaining = formatted.substring(lastIdx);
    tokens.push(remaining.replace(/</g, '&lt;').replace(/>/g, '&gt;'));

    return tokens.join('');
  }
}
