import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { WatchlistService } from '../watchlist/watchlist.service';
import { StockService } from '../stock/stock.service';
import { NewsService } from '../news/news.service';
import { AiService } from '../ai/ai.service';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;

  constructor(
    private readonly configService: ConfigService,
    private readonly watchlistService: WatchlistService,
    private readonly stockService: StockService,
    private readonly newsService: NewsService,
    private readonly aiService: AiService,
  ) {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.error('TELEGRAM_BOT_TOKEN chưa được cấu hình trong file .env');
    } else {
      this.bot = new Telegraf(token);
    }
  }

  async onModuleInit() {
    if (!this.bot) return;

    this.registerCommands();
    this.bot.launch().then(() => {
      this.logger.log('🤖 Telegram Bot đã khởi chạy thành công và đang lắng nghe câu lệnh...');
    }).catch((err) => {
      this.logger.error(`Không thể kết nối Telegram Bot: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.bot) {
      try {
        this.bot.stop('SIGTERM');
        this.logger.log('🛑 Telegram Bot đã ngắt kết nối an toàn.');
      } catch (e) {}
    }
  }

  private registerCommands() {
    // 1. /start hoặc /help
    this.bot.command(['start', 'help'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      const helpMessage = `
📈 <b>CHÀO MỪNG ĐẾN VỚI BOT PHÂN TÍCH & DÒNG TIỀN CHỨNG KHOÁN VN</b> 🇻🇳

Các lệnh hỗ trợ:
➕ <code>/add MÃ</code> - Thêm cổ phiếu vào danh mục theo dõi (VD: <code>/add FPT</code>)
➖ <code>/remove MÃ</code> - Xóa cổ phiếu khỏi danh mục (VD: <code>/remove FPT</code>)
📋 <code>/watchlist</code> - Xem bảng giá & dòng tiền thời gian thực các mã đang theo dõi
⚡ <code>/flow</code> - Top cổ phiếu có dòng tiền Mua ròng chủ động đột biến nhất
📊 <code>/stock MÃ</code> - Xem chi tiết kỹ thuật & dòng tiền 1 cổ phiếu (VD: <code>/stock HPG</code>)
📰 <code>/news MÃ</code> - Xem tin tức mới nhất bài báo theo mã (VD: <code>/news CMG</code>)
🏦 <code>/finance MÃ</code> - Phân tích Báo cáo tài chính Quý/Năm (VD: <code>/finance FPT</code>)
🤖 <code>/ai MÃ</code> - Google Gemini AI phân tích cổ phiếu theo 10 tiêu chí chuyên sâu (VD: <code>/ai FPT</code>)
      `;
      await ctx.replyWithHTML(helpMessage);
    });

    // 2. /add <SYMBOL>
    this.bot.command('add', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/add FPT</code>');
      }

      const symbol = parts[1].toUpperCase();
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;

      const result = await this.watchlistService.addSymbol(chatId, username, symbol);
      await ctx.replyWithHTML(result.message);
    });

    // 3. /remove <SYMBOL>
    this.bot.command('remove', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu cần xóa. Ví dụ: <code>/remove FPT</code>');
      }

      const symbol = parts[1].toUpperCase();
      const chatId = ctx.chat.id.toString();

      const result = await this.watchlistService.removeSymbol(chatId, symbol);
      await ctx.replyWithHTML(result.message);
    });

    // 4. /watchlist
    this.bot.command(['watchlist', 'danhdm'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const symbols = await this.watchlistService.getUserWatchlist(chatId);

      if (symbols.length === 0) {
        return ctx.replyWithHTML('📭 Danh mục theo dõi của bạn đang trống.\nSử dụng <code>/add MÃ</code> để thêm cổ phiếu (VD: <code>/add FPT</code>).');
      }

      await ctx.replyWithHTML('⌛ Đang tải dữ liệu dòng tiền real-time...');

      let responseText = `📊 <b>BẢNG GIÁ & DÒNG TIỀN THEO DÕI REAL-TIME</b>\n\n`;

      for (const sym of symbols) {
        const detail = await this.stockService.getStockDetail(sym);
        if (detail) {
          const icon = detail.change > 0 ? '🟢' : detail.change < 0 ? '🔴' : '🟡';
          const flowIcon = detail.flowTrend === 'BULLISH' ? '🔥 Mua ròng mạnh' : detail.flowTrend === 'BEARISH' ? '❄️ Bán ròng mạnh' : '⚖️ Cân bằng';

          responseText += `${icon} <b>${detail.symbol}</b>: <b>${detail.currentPrice}k</b> (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)\n`;
          responseText += `  • Mua CĐ: ${(detail.activeBuyVolume / 1000).toFixed(0)}k | Bán CĐ: ${(detail.activeSellVolume / 1000).toFixed(0)}k\n`;
          responseText += `  • Dòng tiền ròng: <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} tỷ</b> (${flowIcon})\n`;
          responseText += `  • Khối ngoại: ${detail.foreignNetBuyVolume > 0 ? 'Mua ròng' : 'Bán ròng'} ${Math.abs(Math.round(detail.foreignNetBuyVolume / 1000))}k CP\n\n`;
        }
      }

      await ctx.replyWithHTML(responseText);
    });

    // 5. /flow <SYMBOL>
    this.bot.command('flow', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML('⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/flow FPT</code>');
      }

      const symbol = parts[1].toUpperCase();
      const detail = await this.stockService.getStockDetail(symbol);

      if (!detail) {
        return ctx.replyWithHTML(`❌ Không tìm thấy thông tin cho mã <b>${symbol}</b>`);
      }

      const priceIcon = detail.change > 0 ? '🟢' : detail.change < 0 ? '🔴' : '🟡';
      const trendText = detail.flowTrend === 'BULLISH'
        ? '🚀 <b>DÒNG TIỀN TÍCH CỰC - MUA CHỦ ĐỘNG ÁP ĐẢO</b>'
        : detail.flowTrend === 'BEARISH'
        ? '🚨 <b>DÒNG TIỀN TIÊU CỰC - ÁP LỰC BÁN CHỦ ĐỘNG RỘNG</b>'
        : '⚖️ <b>DÒNG TIỀN GIẰNG CO TRONG BIÊN ĐỘ THẸP</b>';

      const message = `
🌊 <b>PHÂN TÍCH DÒNG TIỀN REAL-TIME - MÃ ${detail.symbol}</b>

${priceIcon} <b>Giá hiện tại:</b> ${detail.currentPrice},000 VNĐ (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)
📈 <b>Tham chiếu / Cao / Thấp:</b> ${detail.refPrice}k / ${detail.highPrice}k / ${detail.lowPrice}k
📊 <b>Tổng khối lượng giao dịch:</b> ${(detail.totalVolume / 1000).toFixed(0)}k CP

🛒 <b>Lệnh Mua Chủ Động:</b> ${(detail.activeBuyVolume / 1000).toFixed(0)}k CP
🔻 <b>Lệnh Bán Chủ Động:</b> ${(detail.activeSellVolume / 1000).toFixed(0)}k CP
💵 <b>Dòng tiền Mua/Bán Ròng:</b> <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ</b>

🏦 <b>Giao Dịch Khối Ngoại:</b>
  • Mua: ${(detail.foreignBuyVolume / 1000).toFixed(0)}k CP | Bán: ${(detail.foreignSellVolume / 1000).toFixed(0)}k CP
  • Ròng: <b>${detail.foreignNetBuyVolume > 0 ? '+' : ''}${(detail.foreignNetBuyVolume / 1000).toFixed(0)}k CP</b>

📌 <b>Đánh Giá:</b> ${trendText}
      `;

      await ctx.replyWithHTML(message);
    });

    // 6. /topflow
    this.bot.command('topflow', async (ctx) => {
      await ctx.replyWithHTML('⌛ Đang quét toàn thị trường tìm Top cổ phiếu thu hút dòng tiền...');

      const topList = await this.stockService.getTopFlowStocks();

      let msg = `🔥 <b>TOP CỔ PHIẾU DÒNG TIỀN MUA RÒNG MẠNH NHẤT</b>\n\n`;
      topList.forEach((item, index) => {
        const icon = item.changePercent > 0 ? '🟢' : item.changePercent < 0 ? '🔴' : '🟡';
        msg += `${index + 1}. ${icon} <b>${item.symbol}</b>: <b>${item.price}k</b> (${item.changePercent > 0 ? '+' : ''}${item.changePercent}%)\n`;
        msg += `   👉 Dòng tiền Mua ròng: <b>+${item.netActiveValueBillion} tỷ</b>\n`;
      });

      await ctx.replyWithHTML(msg);
    });

    // 7. /news <SYMBOL>
    this.bot.command('news', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        const quickKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('📰 FPT', 'news:FPT'),
            Markup.button.callback('📰 HPG', 'news:HPG'),
            Markup.button.callback('📰 VNM', 'news:VNM'),
            Markup.button.callback('📰 SSI', 'news:SSI'),
          ],
          [
            Markup.button.callback('📰 MBB', 'news:MBB'),
            Markup.button.callback('📰 TCB', 'news:TCB'),
            Markup.button.callback('📰 MWG', 'news:MWG'),
            Markup.button.callback('📰 CMG', 'news:CMG'),
          ],
        ]);

        return ctx.replyWithHTML(
          '⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/news HPG</code> hoặc chọn mã bên dưới:',
          quickKeyboard
        );
      }

      const symbol = parts[1].toUpperCase();
      await ctx.replyWithHTML(`⌛ Đang quét tin tức mới nhất cho mã <b>${symbol}</b>...`);

      const { text: msg, keyboard } = await this.buildNewsView(symbol);
      if (keyboard) {
        await ctx.replyWithHTML(msg, keyboard);
      } else {
        await ctx.replyWithHTML(msg);
      }
    });

    // Lắng nghe sự kiện chọn mã tin tức từ nút bấm
    this.bot.action(/^news:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery('⌛ Đang tải tin tức...');
        const symbol = ctx.match[1].toUpperCase();
        const { text: msg, keyboard } = await this.buildNewsView(symbol);

        try {
          if (keyboard) {
            await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
          } else {
            await ctx.editMessageText(msg, { parse_mode: 'HTML' });
          }
        } catch (err) {
          if (err.message && err.message.includes('message is not modified')) {
            return;
          }
          throw err;
        }
      } catch (error) {
        this.logger.error(`Lỗi xử lý click button News: ${error.message}`);
      }
    });

    // 8. /finance <SYMBOL> [QUÝ] [NĂM] hoặc /fa hoặc /baocao
    this.bot.command(['finance', 'fa', 'baocao'], async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML(
          '⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/finance FPT</code> hoặc <code>/fa HPG</code>'
        );
      }

      const symbol = parts[1].toUpperCase();
      let quarter: number | undefined = undefined;
      let year: number | undefined = undefined;

      for (let i = 2; i < parts.length; i++) {
        const arg = parts[i].toUpperCase().replace('Q', '').trim();
        const num = parseInt(arg, 10);
        if (!isNaN(num)) {
          if (num >= 1 && num <= 4 && !quarter) {
            quarter = num;
          } else if (num >= 2000 && num <= 2100 && !year) {
            year = num;
          }
        }
      }

      await ctx.replyWithHTML(`⌛ Đang lấy dữ liệu Báo cáo tài chính mã <b>${symbol}</b>...`);

      const { text: msg, keyboard } = await this.buildFinancialAnalysisView(symbol, quarter, year);
      await ctx.replyWithHTML(msg, keyboard);
    });

    // 9. Lắng nghe sự kiện người dùng nhấn nút Inline Keyboard chọn Quý/Năm BCTC
    this.bot.action(/^fa:(.+)$/, async (ctx) => {
      try {
        await ctx.answerCbQuery('⌛ Đang tải Báo cáo tài chính...');
        const payload = ctx.match[1]; // Ví dụ: "FPT:latest", "FPT:1:2024", "FPT:0:2024"
        const parts = payload.split(':');
        const symbol = parts[0].toUpperCase();
        const quarterArg = parts[1];
        const yearArg = parts[2];

        let quarter: number | undefined = undefined;
        let year: number | undefined = undefined;

        if (quarterArg && quarterArg !== 'latest') {
          const qNum = parseInt(quarterArg, 10);
          if (qNum >= 1 && qNum <= 4) quarter = qNum;
        }

        if (yearArg) {
          const yNum = parseInt(yearArg, 10);
          if (yNum >= 2000) year = yNum;
        }

        this.logger.log(`👆 Nhận sự kiện chọn BCTC: Mã=${symbol}, Quý=${quarter || 'Tất cả/Gần nhất'}, Năm=${year || 'Gần nhất'}`);

        const { text: msg, keyboard } = await this.buildFinancialAnalysisView(symbol, quarter, year);

        try {
          await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
        } catch (err) {
          if (err.message && err.message.includes('message is not modified')) {
            return; // Người dùng bấm lại nút của kỳ BCTC đang xem sẵn -> Bỏ qua lỗi Telegram 400
          }
          throw err;
        }
      } catch (error) {
        this.logger.error(`Lỗi xử lý click button BCTC: ${error.message}`);
      }
    });

    // 10. /ai <SYMBOL> hoặc /gemini <SYMBOL> hoặc /ai_analysis <SYMBOL>
    this.bot.command(['ai', 'gemini', 'ai_analysis'], async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        const quickKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🤖 FPT', 'ai:FPT:summary'),
            Markup.button.callback('🤖 HPG', 'ai:HPG:summary'),
            Markup.button.callback('🤖 VNM', 'ai:VNM:summary'),
            Markup.button.callback('🤖 SSI', 'ai:SSI:summary'),
          ],
          [
            Markup.button.callback('🤖 MBB', 'ai:MBB:summary'),
            Markup.button.callback('🤖 TCB', 'ai:TCB:summary'),
            Markup.button.callback('🤖 MWG', 'ai:MWG:summary'),
            Markup.button.callback('🤖 CMG', 'ai:CMG:summary'),
          ],
        ]);

        return ctx.replyWithHTML(
          '⚠️ Vui lòng nhập mã cổ phiếu cần AI phân tích. Ví dụ: <code>/ai FPT</code> hoặc bấm chọn nhanh bên dưới:',
          quickKeyboard,
        );
      }

      const symbol = parts[1].toUpperCase();
      await ctx.replyWithHTML(`⌛ <b>Google Gemini AI</b> đang phân tích cổ phiếu <b>${symbol}</b> với dữ liệu kỹ thuật thực tế...\n📊 Đang lấy dữ liệu lịch sử + tính RSI, MACD, MA, Support/Resistance...\n🎨 Đang vẽ biểu đồ giá...`);

      const { text: msg, keyboard, chartUrl } = await this.buildAiAnalysisView(symbol, 'summary');

      // Gửi ảnh biểu đồ trước
      if (chartUrl) {
        try {
          await ctx.replyWithPhoto({ url: chartUrl }, {
            caption: `📊 Biểu đồ giá ${symbol} (60 phiên) | MA20 | MA50 | Bollinger Bands\n🎯 Điểm mua an toàn & Stop Loss đã đánh dấu trên chart`,
          });
        } catch (chartErr) {
          this.logger.error(`Lỗi gửi biểu đồ ${symbol}: ${chartErr.message}`);
        }
      }

      // Gửi text phân tích
      await ctx.replyWithHTML(msg, keyboard);
    });

    // 11. Lắng nghe sự kiện người dùng bấm chọn các mục phân tích AI
    this.bot.action(/^ai:([A-Z0-9]+):?([a-z]*)$/i, async (ctx) => {
      try {
        await ctx.answerCbQuery('⌛ Đang tải phân tích AI...');
        const symbol = ctx.match[1].toUpperCase();
        const section = (ctx.match[2] as any) || 'summary';

        const { text: msg, keyboard, chartUrl } = await this.buildAiAnalysisView(symbol, section);

        // Nếu là summary và có chart, gửi ảnh mới
        if (section === 'summary' && chartUrl) {
          try {
            await ctx.replyWithPhoto({ url: chartUrl }, {
              caption: `📊 Biểu đồ giá ${symbol} (60 phiên) | MA20 | MA50 | Bollinger Bands`,
            });
          } catch (chartErr) {
            this.logger.debug(`Không gửi được biểu đồ cập nhật: ${chartErr.message}`);
          }
        }

        try {
          await ctx.editMessageText(msg, { parse_mode: 'HTML', ...keyboard });
        } catch (err) {
          if (err.message && err.message.includes('message is not modified')) {
            return;
          }
          // Nếu không edit được (message quá cũ), gửi message mới
          try {
            await ctx.replyWithHTML(msg, keyboard);
          } catch (replyErr) {
            this.logger.error(`Không gửi được tin nhắn: ${replyErr.message}`);
          }
        }
      } catch (error) {
        this.logger.error(`Lỗi xử lý click button AI Analysis: ${error.message}`);
      }
    });
  }

  /**
   * Tạo giao diện Báo cáo tài chính kèm các nút bấm chọn Quý / Năm
   */
  private async buildFinancialAnalysisView(symbol: string, quarter?: number, year?: number) {
    const analysis = await this.stockService.getFinancialAnalysis(symbol, quarter, year);
    const r = analysis.ratios;

    const starRating = '⭐'.repeat(Math.round(analysis.healthScore)) + ` (${analysis.healthScore}/5.0)`;
    const healthBadge = analysis.healthStatus === 'EXCELLENT' ? '🌟 Xuất sắc'
      : analysis.healthStatus === 'GOOD' ? '🟢 Tốt'
      : analysis.healthStatus === 'NEUTRAL' ? '🟡 Trung bình'
      : analysis.healthStatus === 'WARNING' ? '⚠️ Cảnh báo'
      : '🚨 Rủi ro cao';

    const valuationBadge = analysis.valuationStatus === 'CHEAP' ? '🟢 Hấp dẫn (Giá tốt)'
      : analysis.valuationStatus === 'EXPENSIVE' ? '🔴 Đắt (Áp lực điều chỉnh)'
      : '🟡 Hợp lý';

    let msg = `📊 <b>PHÂN TÍCH BÁO CÁO TÀI CHÍNH - MÃ ${analysis.symbol}</b>\n`;
    msg += `📅 <b>Kỳ báo cáo:</b> ${analysis.reportPeriod} | <b>Ngày xuất BCTC:</b> ${analysis.publishDate}\n\n`;
    msg += `🏥 <b>Sức khỏe tài chính:</b> ${healthBadge} | <b>Đánh giá:</b> ${starRating}\n`;
    msg += `🏷️ <b>Định giá cổ phiếu:</b> ${valuationBadge}\n\n`;

    msg += `💎 <b>CHỈ SỐ ĐỊNH GIÁ & HIỆU QUẢ SỬ DỤNG VỐN:</b>\n`;
    msg += `  • <b>P/E:</b> ${r.pe > 0 ? r.pe + ' lần' : 'N/A'} | <b>P/B:</b> ${r.pb > 0 ? r.pb + ' lần' : 'N/A'}\n`;
    msg += `  • <b>EPS:</b> ${r.eps > 0 ? r.eps.toLocaleString('vi-VN') + ' VNĐ' : 'N/A'}\n`;
    msg += `  • <b>ROE (Sinh lời/VCSH):</b> <b>${r.roe}%</b>\n`;
    msg += `  • <b>ROA (Sinh lời/Tổng tài sản):</b> ${r.roa}%\n\n`;

    msg += `📈 <b>TĂNG TRƯỞNG & BIÊN LỢI NHUẬN (YoY):</b>\n`;
    msg += `  • <b>Tăng trưởng doanh thu:</b> ${r.revenueGrowth > 0 ? '+' : ''}${r.revenueGrowth}%\n`;
    msg += `  • <b>Tăng trưởng lợi nhuận:</b> <b>${r.profitGrowth > 0 ? '+' : ''}${r.profitGrowth}%</b>\n`;
    msg += `  • <b>Biên lợi nhuận gộp:</b> ${r.grossMargin}%\n`;
    msg += `  • <b>Biên lợi nhuận ròng:</b> ${r.netMargin}%\n\n`;

    msg += `🏦 <b>CƠ CẤU TÀI SẢN & NỢ:</b>\n`;
    msg += `  • <b>Nợ / Vốn CSH (D/E):</b> ${r.deRatio} lần\n`;
    if (r.revenue > 0) msg += `  • <b>Doanh thu:</b> ${r.revenue.toLocaleString('vi-VN')} Tỷ VNĐ\n`;
    if (r.netProfit > 0) msg += `  • <b>Lợi nhuận ròng:</b> ${r.netProfit.toLocaleString('vi-VN')} Tỷ VNĐ\n`;

    msg += `\n✅ <b>ĐIỂM MẠNH TÀI CHÍNH:</b>\n`;
    analysis.strengths.forEach((s) => {
      msg += `  • ${s}\n`;
    });

    msg += `\n⚠️ <b>RỦI RO CẦN LƯU Ý:</b>\n`;
    analysis.risks.forEach((rk) => {
      msg += `  • ${rk}\n`;
    });

    msg += `\n💡 <b>KHUYẾN NGHỊ ĐẦU TƯ:</b>\n${analysis.recommendation}\n`;

    msg += `\n📖 <b>GHI CHÚ THUẬT NGỮ CHỨNG KHOÁN:</b>\n`;
    msg += `• <b>P/E (Price/Earnings):</b> Giá cổ phiếu / Lợi nhuận 1 cổ phiếu (Số năm thu hồi vốn).\n`;
    msg += `• <b>P/B (Price/Book):</b> Giá cổ phiếu / Giá trị sổ sách (So sánh giá thị trường với tài sản thực).\n`;
    msg += `• <b>EPS (Earnings Per Share):</b> Lợi nhuận ròng tính trên mỗi cổ phiếu.\n`;
    msg += `• <b>ROE (Return on Equity):</b> Tỷ suất sinh lời trên vốn chủ sở hữu (ROE trên 15% là rất tốt).\n`;
    msg += `• <b>ROA (Return on Assets):</b> Tỷ suất sinh lời trên tổng tài sản.\n`;
    msg += `• <b>D/E (Debt/Equity):</b> Tỷ lệ nợ / vốn CSH (D/E dưới 1.0 là an toàn tài chính).`;

    // Tạo các nút bấm tương tác (Inline Keyboard Buttons) 100% ĐỘNG dựa trên dữ liệu thực tế API KBS
    const keyboardRows: any[] = [];
    const periods = analysis.availablePeriods || [];

    if (periods.length > 0) {
      const latest = periods[0];
      keyboardRows.push([
        Markup.button.callback(`⚡ Mới nhất (${latest.label})`, `fa:${analysis.symbol}:latest`),
      ]);

      const buttons: any[] = periods.map((p) =>
        Markup.button.callback(`${p.label}`, `fa:${analysis.symbol}:${p.quarter}:${p.year}`)
      );

      // Chia đều 3 nút trên một dòng giao diện Telegram
      for (let i = 0; i < buttons.length; i += 3) {
        keyboardRows.push(buttons.slice(i, i + 3));
      }
    } else {
      keyboardRows.push([
        Markup.button.callback(`⚡ Mới nhất`, `fa:${analysis.symbol}:latest`),
      ]);
    }

    const keyboard = Markup.inlineKeyboard(keyboardRows);

    return { text: msg, keyboard };
  }

  /**
   * Tạo giao diện tin tức mới nhất của cổ phiếu kèm nút bấm liên kết trực tiếp
   */
  private async buildNewsView(symbol: string) {
    const cleanSym = symbol.toUpperCase();
    let articles = await this.newsService.getLatestNewsBySymbol(cleanSym, 5);

    if (articles.length === 0) {
      await this.newsService.fetchAndStoreLatestNews();
      articles = await this.newsService.getLatestNewsBySymbol(cleanSym, 5);
    }

    if (articles.length === 0) {
      const msg = `📭 Chưa tìm thấy tin tức mới phát sinh liên quan tới mã <b>${cleanSym}</b>.`;
      return { text: msg, keyboard: null };
    }

    const numberIcons = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
    let msg = `📰 <b>TIN TỨC MỚI NHẤT LIÊN QUAN TỚI MÃ ${cleanSym}</b>\n\n`;

    const buttons: any[] = [];

    articles.slice(0, 5).forEach((article, index) => {
      const icon = numberIcons[index] || `🔹`;
      const pubDate = new Date(article.publishedAt || article.createdAt);
      const dateStr = pubDate.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = pubDate.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

      msg += `${icon} <b>${article.title}</b>\n`;
      if (article.summary && article.summary !== article.title) {
        msg += `   <i>${article.summary.slice(0, 120)}...</i>\n`;
      }
      msg += `   📅 <b>Ngày ra tin:</b> ${dateStr} ${timeStr} | 📌 Nguồn: <b>${article.source}</b>\n\n`;

      // Tạo nút bấm dạng URL liên kết tới bài báo
      buttons.push([
        Markup.button.url(`${icon} Đọc tin: ${article.title.slice(0, 30)}...`, article.url),
      ]);
    });

    const keyboard = Markup.inlineKeyboard(buttons);
    return { text: msg, keyboard };
  }

  /**
   * Tạo giao diện phân tích AI Gemini theo 10 tiêu chí chuyên sâu
   * Với dữ liệu kỹ thuật THỰC TẾ + biểu đồ giá
   */
  private async buildAiAnalysisView(
    symbol: string,
    section: 'summary' | 'short' | 'long' | 'valuation' | 'catalyst' = 'summary',
  ) {
    const cleanSym = symbol.toUpperCase();

    // 1. Lấy phân tích toàn diện (giá lịch sử + kỹ thuật + tài chính + chart)
    const fullAnalysis = await this.stockService.getFullAnalysis(cleanSym);

    // 2. Lấy tin tức
    const news = await this.newsService.getLatestNewsBySymbol(cleanSym, 5);

    // 3. Gọi AI phân tích với dữ liệu kỹ thuật thực tế
    const msg = await this.aiService.analyzeStockWithAi(
      cleanSym,
      fullAnalysis.stockDetail,
      fullAnalysis.financial,
      news,
      fullAnalysis.technicals,
      fullAnalysis.safeBuy,
      fullAnalysis.scenarios,
      section,
    );

    // 4. Tạo keyboard
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📋 Tổng quan AI', `ai:${cleanSym}:summary`),
        Markup.button.callback('📈 Ngắn hạn & Plan', `ai:${cleanSym}:short`),
      ],
      [
        Markup.button.callback('📊 Dài hạn & BCTC', `ai:${cleanSym}:long`),
        Markup.button.callback('💎 Định giá & Moat', `ai:${cleanSym}:valuation`),
      ],
      [
        Markup.button.callback('🚀 Catalyst & Vĩ mô', `ai:${cleanSym}:catalyst`),
      ],
    ]);

    return { text: msg, keyboard, chartUrl: fullAnalysis.chartUrl };
  }

  /**
   * Phương thức hỗ trợ gửi thông báo tự động từ Cron job tới Telegram Chat (kèm nút bấm nếu có)
   */
  async sendMessage(chatId: string, message: string, keyboard?: any) {
    if (!this.bot) return;
    try {
      if (keyboard) {
        await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML', ...keyboard });
      } else {
        await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
      }
    } catch (error) {
      this.logger.error(`Lỗi khi gửi tin nhắn tới Telegram Chat ID ${chatId}: ${error.message}`);
    }
  }

  /**
   * Gửi ảnh kèm caption tới Telegram chat
   */
  async sendPhoto(chatId: string, photoUrl: string, caption?: string) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendPhoto(chatId, { url: photoUrl }, {
        caption: caption || '',
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Lỗi khi gửi ảnh tới Telegram Chat ID ${chatId}: ${error.message}`);
    }
  }
}
