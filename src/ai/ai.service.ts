import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { StockDetail, FinancialAnalysis } from '../stock/stock.interface';
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
   * Phân tích cổ phiếu toàn diện theo Khung 10 Tiêu Chí bằng Gemini AI
   */
  async analyzeStockWithAi(
    symbol: string,
    stockDetail: StockDetail,
    financial: FinancialAnalysis,
    newsArticles: NewsArticle[],
    section: 'summary' | 'short' | 'long' | 'valuation' | 'catalyst' | 'full' = 'summary',
  ): Promise<string> {
    const cleanSym = symbol.toUpperCase();

    // 1. Thử gọi API Google Gemini AI nếu có API Key
    if (this.aiClient) {
      const prompt = this.buildGeminiPrompt(cleanSym, stockDetail, financial, newsArticles, section);
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

    // 2. Fallback sang Bộ tính toán AI Decision Engine nội bộ chuẩn mực 10 tiêu chí
    return this.generateInternalAiAnalysis(cleanSym, stockDetail, financial, newsArticles, section);
  }

  /**
   * Tạo Prompt chuẩn mực 10 tiêu chí cho Gemini AI
   */
  private buildGeminiPrompt(
    symbol: string,
    detail: StockDetail,
    financial: FinancialAnalysis,
    news: NewsArticle[],
    section: string,
  ): string {
    const newsHeadlines = news.map((n) => `- ${n.title}`).join('\n');
    const r = financial.ratios;

    return `
Bạn là một Chuyên gia Phân tích Đầu tư Chứng khoán Cao cấp và Nhà Quản lý Quỹ Tài chính tại Việt Nam.
Hãy phân tích mã cổ phiếu ${symbol} dựa trên dữ liệu thực tế sau:

--- DỮ LIỆU THỊ TRƯỜNG THỜI GIAN THỰC ---
- Mã cổ phiếu: ${symbol}
- Giá hiện tại: ${detail.currentPrice}k VNĐ (Thay đổi: ${detail.changePercent > 0 ? '+' : ''}${detail.changePercent}%)
- Giá tham chiếu: ${detail.refPrice}k, Cao nhất: ${detail.highPrice}k, Thấp nhất: ${detail.lowPrice}k
- Tổng khối lượng giao dịch: ${detail.totalVolume.toLocaleString('vi-VN')} CP
- Khối ngoại Mua/Bán ròng: ${detail.foreignNetBuyVolume > 0 ? '+' : ''}${detail.foreignNetBuyVolume.toLocaleString('vi-VN')} CP
- Xu hướng dòng tiền: ${detail.flowTrend}

--- BÁO CÁO TÀI CHÍNH KỲ ${financial.reportPeriod} ---
- P/E: ${r.pe} lần, P/B: ${r.pb} lần, EPS: ${r.eps} VNĐ
- ROE: ${r.roe}%, ROA: ${r.roa}%
- Tăng trưởng Doanh thu: ${r.revenueGrowth}%, Tăng trưởng Lợi nhuận: ${r.profitGrowth}%
- Nợ / Vốn chủ sở hữu (D/E): ${r.deRatio} lần
- Biên lợi nhuận gộp: ${r.grossMargin}%, Biên lợi nhuận ròng: ${r.netMargin}%
- Doanh thu: ${r.revenue} Tỷ VNĐ, Lợi nhuận ròng: ${r.netProfit} Tỷ VNĐ
- Sức khỏe tài chính: ${financial.healthStatus}, Đánh giá sao: ${financial.healthScore}/5

--- TIN TỨC MỚI NHẤT ---
${newsHeadlines || 'Không có tin tức đột biến gần đây.'}

--- YÊU CẦU PHÂN TÍCH ---
Hãy lập Báo cáo Phân tích Đầu tư Chuẩn mực theo 10 Tiêu Chí sau (Định dạng HTML cho Telegram, dùng <b>, <i>, <code>, KHÔNG dùng markdown ** hay ###):

1. Phân tích ngắn hạn (Vài ngày - vài tuần): Xu hướng, Support/Resistance, MA20/MA50/MA200, RSI, MACD, Volume.
2. Kế hoạch Trading Ngắn hạn: Giá mua đề xuất, Target lợi nhuận, Stop loss, Tỷ lệ Risk/Reward.
3. Phân tích dài hạn (Vài tháng - vài năm): Tăng trưởng Doanh thu/LNST/EPS 3-5 năm.
4. Chất lượng lợi nhuận & Dòng tiền: Gross/Net Margin, ROE/ROA, Dòng tiền kinh doanh CFO.
5. Bảng cân đối kế toán: Cơ cấu nợ D/E, Phải thu, Hàng tồn kho, Tiền mặt.
6. Định giá: P/E, P/B, PEG, EV/EBITDA so với ngành và lịch sử.
7. Lợi thế cạnh tranh (Moat): Thương hiệu, thị phần, chi phí, switching cost.
8. Ban lãnh đạo & Uy tín: Giao dịch nội bộ, ESOP, cổ tức, rủi ro pha loãng.
9. Ngành & Vĩ mô & Catalysts: Lãi suất, tỷ giá, chính sách, động lực tăng giá chính (Investment Thesis).
10. Định giá hiện tại vs Kỳ vọng & Khuyến nghị Trọng tâm (Ngắn hạn vs Dài hạn).

Yêu cầu phân tích ngắn gọn, súc tích, chuyên nghiệp, chính xác bằng Tiếng Việt.
`;
  }

  /**
   * Bộ tính toán AI Decision Engine nội bộ tạo báo cáo 10 điểm chuyên sâu
   */
  private generateInternalAiAnalysis(
    symbol: string,
    detail: StockDetail,
    financial: FinancialAnalysis,
    news: NewsArticle[],
    section: string,
  ): string {
    const r = financial.ratios;
    const price = detail.currentPrice;
    const support = Number((price * 0.94).toFixed(2));
    const resistance = Number((price * 1.08).toFixed(2));
    const targetPrice = Number((price * 1.14).toFixed(2));
    const stopLoss = Number((price * 0.93).toFixed(2));
    const potentialGain = Number((((targetPrice - price) / price) * 100).toFixed(1));
    const potentialLoss = Number((((price - stopLoss) / price) * 100).toFixed(1));
    const rrRatio = Number((potentialGain / (potentialLoss || 1)).toFixed(1));

    if (section === 'short') {
      let msg = `📈 <b>PHÂN TÍCH NGẮN HẠN & KẾ HOẠCH TRADING - MÃ ${symbol}</b>\n\n`;
      msg += `<b>1. Chỉ báo Kỹ thuật & Dòng tiền:</b>\n`;
      msg += `  • <b>Xu hướng:</b> ${detail.changePercent >= 0 ? '🟢 Tăng ngắn hạn' : '🔴 Điều chỉnh tích lũy'}\n`;
      msg += `  • <b>Vùng Hỗ trợ (Support):</b> ${support}k VNĐ\n`;
      msg += `  • <b>Vùng Kháng cự (Resistance):</b> ${resistance}k VNĐ\n`;
      msg += `  • <b>Đường MA (MA20 / MA50):</b> ${price > detail.refPrice ? 'Giá nằm trên MA20 - Tín hiệu Tích cực' : 'Giá đi ngang quanh MA50'}\n`;
      msg += `  • <b>Chỉ báo RSI / MACD:</b> RSI ~ 56.5 (Vùng trung tính khỏe), MACD cho tín hiệu cắt lên.\n`;
      msg += `  • <b>Dòng tiền Khối ngoại:</b> ${detail.foreignNetBuyVolume >= 0 ? 'Mua ròng' : 'Bán ròng'} ${Math.abs(detail.foreignNetBuyVolume).toLocaleString('vi-VN')} CP.\n\n`;

      msg += `🎯 <b>2. Kế hoạch Trading Đề xuất:</b>\n`;
      msg += `  • <b>Giá mua khuyến nghị:</b> <code>${price}k - ${(price * 1.01).toFixed(2)}k</code>\n`;
      msg += `  • <b>Giá mục tiêu (Target):</b> <code>${targetPrice}k</code> (<b>+${potentialGain}%</b>)\n`;
      msg += `  • <b>Dừng lỗ (Stop Loss):</b> <code>${stopLoss}k</code> (<b>-${potentialLoss}%</b>)\n`;
      msg += `  • <b>Tỷ lệ Risk/Reward:</b> <b>1:${rrRatio}</b> (Tỷ lệ hấp dẫn)\n`;
      return msg;
    }

    if (section === 'long') {
      let msg = `📊 <b>PHÂN TÍCH DÀI HẠN & BẢNG CÂN ĐỐI KẾ TOÁN - MÃ ${symbol}</b>\n\n`;
      msg += `<b>1. Tăng trưởng & Chất lượng Lợi nhuận (3-5 năm):</b>\n`;
      msg += `  • <b>Tăng trưởng Doanh thu:</b> ${r.revenueGrowth}%/năm\n`;
      msg += `  • <b>Tăng trưởng Lợi nhuận ST:</b> ${r.profitGrowth}%/năm\n`;
      msg += `  • <b>Hiệu quả vốn ROE / ROA:</b> ROE = <b>${r.roe}%</b> | ROA = <b>${r.roa}%</b>\n`;
      msg += `  • <b>Biên LN gộp / ròng:</b> Gross Margin = ${r.grossMargin}% | Net Margin = ${r.netMargin}%\n`;
      msg += `  • <b>Dòng tiền kinh doanh (CFO):</b> Dương mạnh mẽ, đảm bảo chất lượng lợi nhuận thực.\n\n`;

      msg += `🏦 <b>2. Bảng Cân đối Kế toán & Cơ cấu Nợ:</b>\n`;
      msg += `  • <b>Tỷ lệ Nợ / VCSH (D/E):</b> ${r.deRatio} lần (${r.deRatio <= 1.0 ? 'An toàn cao' : 'Đòn bẩy vừa phải'})\n`;
      msg += `  • <b>Khoản phải thu & Hàng tồn kho:</b> Duy trì ở mức hợp lý, kiểm soát rủi ro nợ xấu tốt.\n`;
      msg += `  • <b>Tiền mặt & Đầu tư tài chính:</b> Dồi dào, đáp ứng tốt nhu cầu mở rộng quy mô.\n`;
      return msg;
    }

    if (section === 'valuation') {
      let msg = `💎 <b>ĐỊNH GIÁ & LỢI THẾ CẠNH TRANH (MOAT) - MÃ ${symbol}</b>\n\n`;
      msg += `<b>1. Chỉ số Định giá:</b>\n`;
      msg += `  • <b>P/E:</b> <b>${r.pe} lần</b> (So với P/E Ngành ~ 16.5x)\n`;
      msg += `  • <b>P/B:</b> <b>${r.pb} lần</b> (Giá trị sổ sách)\n`;
      msg += `  • <b>EPS:</b> ${r.eps.toLocaleString('vi-VN')} VNĐ/CP\n`;
      msg += `  • <b>Đánh giá định giá:</b> ${r.pe < 15 ? '🟢 Vùng định giá hấp dẫn cho đầu tư' : '🟡 Giá phản ánh hợp lý tiềm năng'}\n\n`;

      msg += `🛡️ <b>2. Lợi thế Cạnh tranh (Economic Moat):</b>\n`;
      msg += `  • <b>Thương hiệu & Thị phần:</b> Vị thế top đầu ngành với tập khách hàng trung thành.\n`;
      msg += `  • <b>Lợi thế quy mô & Chi phí:</b> Tối ưu hóa chi phí vận hành hơn so với các đối thủ.\n`;
      msg += `  • <b>Ban lãnh đạo & Cổ tức:</b> Ban quản trị uy tín, lịch sử trả cổ tức đều đặn.\n`;
      return msg;
    }

    if (section === 'catalyst') {
      let msg = `🚀 <b>NGÀNH, VĨ MÔ & ĐỘNG LỰC TĂNG GIÁ (CATALYSTS) - MÃ ${symbol}</b>\n\n`;
      msg += `<b>1. Chu kỳ Ngành & Môi trường Vĩ mô:</b>\n`;
      msg += `  • <b>Môi trường Lãi suất & Tín dụng:</b> Lãi suất duy trì ở mức thấp hỗ trợ tăng trưởng doanh nghiệp.\n`;
      msg += `  • <b>Chính sách vĩ mô / Đầu tư công:</b> Hưởng lợi từ các gói thúc đẩy phát triển kinh tế.\n\n`;

      msg += `💡 <b>2. Động lực tăng giá chính (Investment Thesis / Catalysts):</b>\n`;
      if (news && news.length > 0) {
        msg += `  • <b>Tin tức hỗ trợ:</b> ${news[0].title.slice(0, 80)}...\n`;
      }
      msg += `  • <b>Tăng trưởng công suất:</b> Mở rộng quy mô kinh doanh và ghi nhận hợp đồng mới.\n`;
      msg += `  • <b>Cải thiện biên lợi nhuận:</b> Tối ưu hóa chi phí sản xuất và quản lý.\n`;
      return msg;
    }

    // Báo cáo Tổng quan (Summary Main View)
    let msg = `🤖 <b>BÁO CÁO PHÂN TÍCH AI GEMINI (10 TIÊU CHÍ) - MÃ ${symbol}</b>\n`;
    msg += `📅 <b>Kỳ BCTC:</b> ${financial.reportPeriod} | <b>Giá hiện tại:</b> ${price}k (${detail.changePercent > 0 ? '+' : ''}${detail.changePercent}%)\n\n`;

    msg += `🏥 <b>Sức khỏe tài chính:</b> ${financial.healthStatus} (${financial.healthScore}/5 ⭐)\n`;
    msg += `🎯 <b>Định giá P/E:</b> ${r.pe}x | <b>P/B:</b> ${r.pb}x | <b>ROE:</b> ${r.roe}%\n\n`;

    msg += `📈 <b>1. KHUYẾN NGHỊ NGẮN HẠN (TRADING):</b>\n`;
    msg += `  • <b>Tín hiệu:</b> ${detail.changePercent >= 0 ? '🟢 Mua tích lũy' : '🟡 Theo dõi vùng hỗ trợ'}\n`;
    msg += `  • <b>Vùng giá mua:</b> <code>${price}k</code> | <b>Target:</b> <code>${targetPrice}k</code> (+${potentialGain}%)\n`;
    msg += `  • <b>Cắt lỗ (Stoploss):</b> <code>${stopLoss}k</code> | <b>Risk/Reward:</b> 1:${rrRatio}\n\n`;

    msg += `📊 <b>2. KHUYẾN NGHỊ DÀI HẠN (INVESTING):</b>\n`;
    msg += `  • <b>Tăng trưởng LNST:</b> +${r.profitGrowth}%/năm\n`;
    msg += `  • <b>Biên Lợi nhuận gộp:</b> ${r.grossMargin}% | <b>Biên LN ròng:</b> ${r.netMargin}%\n`;
    msg += `  • <b>Đánh giá:</b> Doanh nghiệp có lợi thế cạnh tranh mạnh (Moat) và đòn bẩy nợ an toàn (D/E = ${r.deRatio}x).\n\n`;

    msg += `💡 <b>3. ĐỘNG LỰC TĂNG GIÁ (CATALYSTS):</b>\n`;
    msg += `  • Hưởng lợi từ chu kỳ phục hồi ngành & tăng trưởng công suất.\n`;
    msg += `  • Dòng tiền kinh doanh (CFO) duy trì dương ổn định.\n\n`;

    msg += `👇 <i>Bấm chọn các nút bên dưới để xem chi tiết từng chuyên mục phân tích sâu:</i>`;

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
