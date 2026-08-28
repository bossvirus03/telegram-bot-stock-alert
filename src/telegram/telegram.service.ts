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

  // Bộ nhớ đệm lưu trữ các tin nhắn hội thoại để liên kết ngữ cảnh khi reply (tối đa 500 tin nhắn gần nhất)
  private readonly chatHistoryStore = new Map<number, {
    messageId: number;
    chatId: string;
    role: 'user' | 'model';
    text: string;
    replyToMessageId?: number;
  }>();

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

🏛️ <b>PHÂN TÍCH TOÀN DIỆN MÃ CỔ PHIẾU:</b>
• Dùng lệnh <code>/analysis MÃ</code> (VD: <code>/analysis SSI</code> hoặc <code>/analysis FPT</code>)
  <i>👉 Bot tự động bóc tách tin tức báo chí mới nhất, phân tích bối cảnh vĩ mô, dòng vốn quỹ ngoại ETF, game doanh nghiệp, BCTC, chỉ số tài chính, ban lãnh đạo & điểm mua kỹ thuật!</i>

🤖 <b>TRÒ CHUYỆN & HỎI ĐÁP VỚI GEMINI AI:</b>
• Dùng lệnh <code>/ai CÂU_HỎI</code> (VD: <code>/ai FPT mua vùng giá này được không?</code> hoặc <code>/ai HPG</code>)
• Sau đó chỉ cần <b>Reply (Trả lời)</b> trực tiếp tin nhắn của Bot để tiếp tục cuộc trò chuyện chuyên sâu với đầy đủ ngữ cảnh!

📋 <b>CÁC LỆNH TÍNH NĂNG NHANH:</b>
🏛️ <code>/analysis MÃ</code> - Báo cáo phân tích toàn diện 7 trụ cột (VD: <code>/analysis SSI</code>)
➕ <code>/add MÃ</code> - Thêm cổ phiếu vào danh mục theo dõi (VD: <code>/add FPT</code>)
➖ <code>/remove MÃ</code> - Xóa cổ phiếu khỏi danh mục (VD: <code>/remove FPT</code>)
📋 <code>/watchlist</code> - Bảng giá & dòng tiền thời gian thực danh mục đang theo dõi
📊 <code>/stock MÃ</code> - Tổng quan kỹ thuật & điểm mua cổ phiếu (VD: <code>/stock HPG</code>)
🌊 <code>/flow MÃ</code> - Phân tích chi tiết dòng tiền Mua/Bán chủ động (VD: <code>/flow FPT</code>)
🔥 <code>/topflow</code> - Top cổ phiếu có dòng tiền Mua ròng đột biến toàn thị trường
📰 <code>/news MÃ</code> - Tin tức bài báo mới nhất theo mã (VD: <code>/news CMG</code>)
🏦 <code>/finance MÃ</code> - Phân tích Báo cáo tài chính Quý/Năm (VD: <code>/finance FPT</code>)
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

    // 6. /stock <SYMBOL> - Xem tổng quan kỹ thuật & dòng tiền cổ phiếu
    this.bot.command('stock', async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        return ctx.replyWithHTML(
          '⚠️ Vui lòng nhập mã cổ phiếu. Ví dụ: <code>/stock FPT</code> hoặc <code>/stock HPG</code>',
        );
      }

      const symbol = parts[1].toUpperCase();
      await ctx.replyWithHTML(`⌛ Đang tải dữ liệu kỹ thuật và dòng tiền mã <b>${symbol}</b>...`);

      const { text: msg, keyboard } = await this.buildStockDetailView(symbol);
      await ctx.replyWithHTML(msg, keyboard);
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

    // 10. Lắng nghe sự kiện thêm mã vào Watchlist từ nút bấm
    this.bot.action(/^wl_add:(.+)$/, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        const chatId = ctx.chat?.id.toString();
        if (!chatId) return;

        const username = ctx.from?.username || ctx.from?.first_name;
        const result = await this.watchlistService.addSymbol(chatId, username, symbol);
        await ctx.answerCbQuery(result.message.replace(/<[^>]*>/g, ''));
        await ctx.replyWithHTML(result.message);
      } catch (error) {
        this.logger.error(`Lỗi xử lý click button Watchlist Add: ${error.message}`);
        await ctx.answerCbQuery('⚠️ Có lỗi xảy ra khi thêm mã vào Watchlist.');
      }
    });

    // 11. Lắng nghe sự kiện bấm nút hỏi AI từ giao diện /stock
    this.bot.action(/^ask_ai:(.+)$/, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        await ctx.answerCbQuery(`⌛ Gemini AI đang phân tích mã ${symbol}...`);
        await this.handleAiConversation(ctx, `Phân tích chuyên sâu mã ${symbol}, đánh giá điểm mua, rủi ro và các yếu tố tác động`, undefined);
      } catch (error) {
        this.logger.error(`Lỗi xử lý click button Ask AI: ${error.message}`);
      }
    });

    // 12. Lệnh /analysis <SYMBOL> (hoặc /phantich, /danhgia) - Báo cáo phân tích chuyên sâu 7 trụ cột
    this.bot.command(['analysis', 'phantich', 'danhgia'], async (ctx) => {
      const text = ctx.message.text.trim();
      const parts = text.split(/\s+/);
      if (parts.length < 2) {
        const quickKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🏛️ Phân tích SSI', 'analysis:SSI'),
            Markup.button.callback('🏛️ Phân tích FPT', 'analysis:FPT'),
            Markup.button.callback('🏛️ Phân tích HPG', 'analysis:HPG'),
          ],
          [
            Markup.button.callback('🏛️ Phân tích VNM', 'analysis:VNM'),
            Markup.button.callback('🏛️ Phân tích MBB', 'analysis:MBB'),
            Markup.button.callback('🏛️ Phân tích MWG', 'analysis:MWG'),
          ],
          [
            Markup.button.callback('🏛️ Phân tích TCB', 'analysis:TCB'),
            Markup.button.callback('🏛️ Phân tích VHM', 'analysis:VHM'),
            Markup.button.callback('🏛️ Phân tích VIC', 'analysis:VIC'),
          ],
        ]);

        return ctx.replyWithHTML(
          '🏛️ <b>PHÂN TÍCH CHUYÊN SÂU TOÀN DIỆN MÃ CỔ PHIẾU</b>\n\n' +
          '• Sử dụng lệnh: <code>/analysis MÃ</code> (Ví dụ: <code>/analysis SSI</code> hoặc <code>/analysis FPT</code>)\n\n' +
          '📊 <i>Hệ thống sẽ tổng hợp tin tức bài báo mới nhất, bối cảnh vĩ mô, dòng vốn quỹ ngoại ETF, game doanh nghiệp, BCTC, chỉ số tài chính, ban lãnh đạo & điểm mua kỹ thuật để lập báo cáo chuyên sâu!</i>\n\n' +
          '👉 Hoặc chọn nhanh cổ phiếu bên dưới:',
          quickKeyboard,
        );
      }

      const symbol = parts[1].toUpperCase();
      await this.handleComprehensiveAnalysis(ctx, symbol);
    });

    // Lắng nghe sự kiện click nút phân tích toàn diện
    this.bot.action(/^analysis:(.+)$/, async (ctx) => {
      try {
        const symbol = ctx.match[1].toUpperCase();
        await ctx.answerCbQuery(`⌛ Đang lập báo cáo phân tích toàn diện mã ${symbol}...`);
        await this.handleComprehensiveAnalysis(ctx, symbol);
      } catch (error) {
        this.logger.error(`Lỗi xử lý click button Analysis: ${error.message}`);
      }
    });

    // 13. Lệnh /ai <CÂU HỎI> (hoặc /chat, /ask, /gemini) để trò chuyện và phân tích chuyên sâu với Gemini AI
    this.bot.command(['ai', 'chat', 'ask', 'gemini'], async (ctx) => {
      const text = ctx.message.text.trim();
      const query = text.replace(/^\/(ai|chat|ask|gemini)(@\w+)?\s*/i, '').trim();

      if (!query) {
        const quickKeyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🤖 Phân tích FPT', 'ask_ai:FPT'),
            Markup.button.callback('🤖 Phân tích HPG', 'ask_ai:HPG'),
            Markup.button.callback('🤖 Phân tích VNM', 'ask_ai:VNM'),
          ],
          [
            Markup.button.callback('🤖 Phân tích SSI', 'ask_ai:SSI'),
            Markup.button.callback('🤖 Phân tích MBB', 'ask_ai:MBB'),
            Markup.button.callback('🤖 Phân tích MWG', 'ask_ai:MWG'),
          ],
        ]);

        return ctx.replyWithHTML(
          '🤖 <b>TRỢ LÝ GEMINI AI CHỨNG KHOÁN</b>\n\n' +
          '• Bắt đầu câu hỏi: <code>/ai &lt;câu hỏi hoặc mã CP&gt;</code>\n' +
          '  <i>(Ví dụ: <code>/ai FPT mua được không?</code> hoặc <code>/ai HPG</code>)</i>\n\n' +
          '• <b>Tiếp tục trò chuyện:</b> Chỉ cần <b>Reply (Trả lời)</b> trực tiếp tin nhắn của Bot để thảo luận liên tục với đầy đủ ngữ cảnh!',
          quickKeyboard,
        );
      }

      await this.handleAiConversation(ctx, query, undefined);
    });

    // 14. Lắng nghe tin nhắn Text: CHỈ phản hồi khi người dùng Reply vào tin nhắn của Bot
    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text.trim();
      // Bỏ qua các câu lệnh bắt đầu bằng /
      if (text.startsWith('/')) {
        return;
      }

      const replyTo = ctx.message.reply_to_message;
      if (!replyTo) {
        // Tin nhắn tự do không reply -> Bỏ qua để không spam chat
        return;
      }

      // Kiểm tra xem tin nhắn được reply có phải là tin nhắn do Bot gửi không
      const isReplyToBot = replyTo.from?.is_bot || this.chatHistoryStore.has(replyTo.message_id);
      if (isReplyToBot) {
        await this.handleAiConversation(ctx, text, replyTo.message_id);
      }
    });
  }

  /**
   * Xử lý báo cáo phân tích toàn diện cho lệnh /analysis
   */
  private async handleComprehensiveAnalysis(ctx: any, symbol: string) {
    const cleanSym = symbol.trim().toUpperCase();
    const chatId = ctx.chat.id.toString();
    const userMsgId = ctx.message?.message_id;
    const username = ctx.from?.username || ctx.from?.first_name;

    await this.watchlistService.registerUser(chatId, username);

    try {
      await ctx.sendChatAction('typing');
    } catch (e) {}

    await ctx.replyWithHTML(
      `⌛ <b>Đang lập Báo cáo Phân tích Toàn diện mã ${cleanSym}...</b>\n` +
      `<i>(Bóc tách tin tức báo chí, BCTC, vĩ mô, quỹ ngoại ETF, game doanh nghiệp & chỉ số tài chính)</i>`,
    );

    try {
      // 1. Thu thập song song tất cả các nguồn dữ liệu thực tế
      const [full, companyProfile, symbolNews, macroNews] = await Promise.all([
        this.stockService.getFullAnalysis(cleanSym),
        this.stockService.getCompanyProfile(cleanSym),
        this.newsService.getLatestNewsBySymbol(cleanSym, 8),
        this.newsService.getUnsentNewsAll(4),
      ]);

      // 2. Tạo báo cáo phân tích chuyên sâu bằng AI (với Fallback Engine)
      const reportText = await this.aiService.analyzeStockComprehensive(
        cleanSym,
        full.stockDetail,
        full.financial,
        symbolNews,
        full.technicals,
        full.safeBuy,
        full.scenarios,
        companyProfile,
        macroNews,
      );

      // 3. Tạo inline keyboard hành động nhanh
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📊 Biểu đồ / Kỹ thuật', `stock:${cleanSym}`),
          Markup.button.callback('🏦 Báo cáo tài chính', `fa:${cleanSym}:latest`),
        ],
        [
          Markup.button.callback('🌊 Dòng tiền Real-time', `flow:${cleanSym}`),
          Markup.button.callback('📰 Tin tức bài báo', `news:${cleanSym}`),
        ],
        [
          Markup.button.callback('➕ Thêm vào Watchlist', `wl_add:${cleanSym}`),
        ],
      ]);

      // 4. Gửi báo cáo phân tích cho người dùng
      let sentMsg: any;
      if (reportText.length <= 4000) {
        sentMsg = await ctx.replyWithHTML(reportText, {
          reply_parameters: userMsgId ? { message_id: userMsgId } : undefined,
          ...keyboard,
        });
      } else {
        const chunks = this.splitMessageIntoChunks(reportText, 3800);
        for (let i = 0; i < chunks.length; i++) {
          const isFirst = i === 0;
          const isLast = i === chunks.length - 1;
          sentMsg = await ctx.replyWithHTML(chunks[i], {
            reply_parameters: isFirst && userMsgId ? { message_id: userMsgId } : undefined,
            ...(isLast ? keyboard : {}),
          });
        }
      }

      // 5. Lưu vào Chat History Store để khi người dùng Reply, bot trả lời tiếp nối ngữ cảnh
      if (sentMsg?.message_id) {
        this.chatHistoryStore.set(sentMsg.message_id, {
          messageId: sentMsg.message_id,
          chatId,
          role: 'model',
          text: reportText,
          replyToMessageId: userMsgId,
        });

        if (this.chatHistoryStore.size > 500) {
          const firstKey = this.chatHistoryStore.keys().next().value;
          if (firstKey !== undefined) {
            this.chatHistoryStore.delete(firstKey);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Lỗi khi tạo Báo cáo Phân tích Toàn diện mã ${cleanSym}: ${error.message}`);
      await ctx.replyWithHTML(`⚠️ Không thể tạo báo cáo phân tích cho mã <b>${cleanSym}</b> lúc này. Vui lòng thử lại sau giây lát!`);
    }
  }

  /**
   * Xử lý câu hỏi hội thoại nhiều lượt với Gemini AI, duy trì chuỗi hội thoại
   */
  private async handleAiConversation(ctx: any, userQuery: string, replyToMessageId?: number) {
    const chatId = ctx.chat.id.toString();
    const userMsgId = ctx.message?.message_id;
    const username = ctx.from?.username || ctx.from?.first_name;

    await this.watchlistService.registerUser(chatId, username);

    try {
      await ctx.sendChatAction('typing');
    } catch (e) {}

    // Lưu tin nhắn của user vào history store
    if (userMsgId) {
      this.chatHistoryStore.set(userMsgId, {
        messageId: userMsgId,
        chatId,
        role: 'user',
        text: userQuery,
        replyToMessageId,
      });
    }

    // 1. Thu thập chuỗi lịch sử hội thoại trước đó (nếu có replyToMessageId)
    const conversationHistory: Array<{ role: 'user' | 'model'; content: string }> = [];
    if (replyToMessageId) {
      let currentId: number | undefined = replyToMessageId;
      const visited = new Set<number>();

      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const item = this.chatHistoryStore.get(currentId);
        if (!item) {
          // Nếu không có trong store (tin nhắn cũ trước khi restart), lấy trực tiếp từ reply_to_message
          if (visited.size === 1 && ctx.message?.reply_to_message?.text) {
            conversationHistory.unshift({
              role: 'model',
              content: ctx.message.reply_to_message.text,
            });
          }
          break;
        }
        conversationHistory.unshift({ role: item.role, content: item.text });
        currentId = item.replyToMessageId;
      }
    }

    // 2. Nhận diện mã cổ phiếu trong câu hỏi hiện tại hoặc các câu hỏi trước
    let stockContext = '';
    try {
      const allText = `${userQuery} ${conversationHistory.map((c) => c.content).join(' ')}`;
      const detectedSymbols = this.newsService.extractStockSymbols(allText);
      
      let symbolInfo = '';
      if (detectedSymbols.length > 0) {
        const targetSymbol = detectedSymbols[0];
        const full = await this.stockService.getFullAnalysis(targetSymbol);
        const d = full.stockDetail;
        const t = full.technicals;
        const f = full.financial;
        const s = full.safeBuy;

        // Lấy các bài báo/tin tức mới nhất của mã cổ phiếu
        const symbolNews = await this.newsService.getLatestNewsBySymbol(targetSymbol, 4);
        const newsList = symbolNews.map((n) => `  • ${n.title} (${n.source})`).join('\n');

        symbolInfo = `
MÃ CỔ PHIẾU: ${targetSymbol}
- Giá hiện tại: ${d.currentPrice}k (${d.change > 0 ? '+' : ''}${d.changePercent}%) | Khối lượng: ${d.totalVolume.toLocaleString('vi-VN')} CP
- Dòng tiền mua ròng chủ động: ${d.netActiveBuyValue > 0 ? '+' : ''}${d.netActiveBuyValue} Tỷ VNĐ (${d.flowTrend})
- Khối ngoại Mua/Bán ròng: ${d.foreignNetBuyVolume > 0 ? '+' : ''}${d.foreignNetBuyVolume.toLocaleString('vi-VN')} CP
- Xu hướng kỹ thuật: ${t.trend} (${t.trendStrength}) | RSI(14): ${t.rsi14} | MACD Hist: ${t.macd.histogram}
- Hỗ trợ gần nhất: ${t.support.join(', ') || 'N/A'}k | Kháng cự: ${t.resistance.join(', ') || 'N/A'}k
- Vùng mua an toàn: ${s.safeBuyRange.min}k - ${s.safeBuyRange.max}k | Target ngắn hạn: ${s.targetShortTerm}k | Stoploss: ${s.stopLoss}k
- Tài chính: BCTC ${f.reportPeriod}, P/E: ${f.ratios.pe}x, ROE: ${f.ratios.roe}%, Tăng trưởng LN: ${f.ratios.profitGrowth}%, Nợ/VCSH: ${f.ratios.deRatio}x
- Tin tức sự kiện mới nhất của mã:
${newsList || '  (Chưa có tin tức đột biến gần đây)'}
        `.trim();
      }

      // Lấy thêm tin tức thị trường/vĩ mô/ETF chung gần nhất
      const marketNews = await this.newsService.getUnsentNewsAll(3);
      const marketNewsStr = marketNews.map((m) => `  • ${m.title}`).join('\n');

      stockContext = `
${symbolInfo}

TIN TỨC THỊ TRƯỜNG & VĨ MÔ/ETF GẦN NHẤT:
${marketNewsStr || '  • Thị trường duy trì thanh khoản ổn định'}
      `.trim();
    } catch (err) {
      this.logger.debug(`Không lấy được context phụ cho mã: ${err.message}`);
    }

    // 3. Gọi Gemini AI với toàn bộ ngữ cảnh
    try {
      const aiResponse = await this.aiService.chatWithAi(userQuery, stockContext, conversationHistory);

      // Gửi phản hồi lại cho người dùng bằng cách reply tin nhắn của họ
      let sentMsg: any;
      if (aiResponse.length <= 4000) {
        sentMsg = await ctx.replyWithHTML(aiResponse, {
          reply_parameters: userMsgId ? { message_id: userMsgId } : undefined,
        });
      } else {
        const chunks = this.splitMessageIntoChunks(aiResponse, 3800);
        for (let i = 0; i < chunks.length; i++) {
          const isFirst = i === 0;
          sentMsg = await ctx.replyWithHTML(chunks[i], {
            reply_parameters: isFirst && userMsgId ? { message_id: userMsgId } : undefined,
          });
        }
      }

      // Lưu tin phản hồi của Bot vào history store
      if (sentMsg?.message_id) {
        this.chatHistoryStore.set(sentMsg.message_id, {
          messageId: sentMsg.message_id,
          chatId,
          role: 'model',
          text: aiResponse,
          replyToMessageId: userMsgId,
        });

        // Giới hạn dung lượng store (giữ tối đa 500 tin gần nhất)
        if (this.chatHistoryStore.size > 500) {
          const firstKey = this.chatHistoryStore.keys().next().value;
          if (firstKey !== undefined) {
            this.chatHistoryStore.delete(firstKey);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Lỗi khi xử lý chat AI: ${error.message}`);
      await ctx.replyWithHTML('⚠️ Rất tiếc, AI tạm thời không thể phản hồi. Vui lòng thử lại sau giây lát!');
    }
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
   * Tạo giao diện hiển thị Tổng quan kỹ thuật, dòng tiền và điểm mua của cổ phiếu (/stock)
   */
  private async buildStockDetailView(symbol: string) {
    const cleanSym = symbol.toUpperCase();
    const full = await this.stockService.getFullAnalysis(cleanSym);
    const detail = full.stockDetail;
    const tech = full.technicals;
    const safeBuy = full.safeBuy;

    const icon = detail.change > 0 ? '🟢' : detail.change < 0 ? '🔴' : '🟡';
    const trendIcon = tech.trend === 'UPTREND' ? '🟢 TĂNG' : tech.trend === 'DOWNTREND' ? '🔴 GIẢM' : '🟡 ĐI NGANG';
    const gainPct = detail.currentPrice > 0 ? (((safeBuy.targetShortTerm - detail.currentPrice) / detail.currentPrice) * 100).toFixed(1) : '0';

    let msg = `📊 <b>TỔNG QUAN KỸ THUẬT & DÒNG TIỀN - MÃ ${cleanSym}</b>\n\n`;

    // 1. Thị giá & Biến động
    msg += `🏷️ <b>Giá hiện tại:</b> ${icon} <b>${detail.currentPrice}k</b> (${detail.change > 0 ? '+' : ''}${detail.changePercent}%)\n`;
    msg += `📈 <b>Tham chiếu / Trần / Sàn:</b> ${detail.refPrice}k / ${detail.highPrice}k / ${detail.lowPrice}k\n`;
    msg += `📦 <b>Tổng Khối lượng:</b> ${(detail.totalVolume / 1000).toFixed(0)}k CP\n\n`;

    // 2. Dòng tiền & Khối ngoại
    msg += `🌊 <b>DÒNG TIỀN REAL-TIME:</b>\n`;
    msg += `  • Mua CĐ: ${(detail.activeBuyVolume / 1000).toFixed(0)}k CP | Bán CĐ: ${(detail.activeSellVolume / 1000).toFixed(0)}k CP\n`;
    msg += `  • Mua ròng CĐ: <b>${detail.netActiveBuyValue > 0 ? '+' : ''}${detail.netActiveBuyValue} Tỷ VNĐ</b>\n`;
    msg += `  • Khối ngoại: ${detail.foreignNetBuyVolume >= 0 ? 'Mua ròng' : 'Bán ròng'} <b>${Math.abs(Math.round(detail.foreignNetBuyVolume / 1000))}k CP</b>\n\n`;

    // 3. Chỉ báo kỹ thuật
    msg += `🔬 <b>CHỈ BÁO KỸ THUẬT:</b>\n`;
    msg += `  • <b>Xu hướng:</b> ${trendIcon} (${tech.trendStrength})\n`;
    msg += `  • <b>RSI (14):</b> <code>${tech.rsi14}</code> (${tech.rsi14 >= 70 ? 'Quá mua' : tech.rsi14 <= 30 ? 'Quá bán' : 'Trung tính'})\n`;
    msg += `  • <b>MACD:</b> <code>${tech.macd.histogram > 0 ? '▲' : '▼'} ${tech.macd.histogram}</code> | <b>Volume:</b> <code>${tech.currentVolumeRatio}x MA20</code>\n`;
    msg += `  • <b>MA20:</b> ${tech.ma20}k | <b>MA50:</b> ${tech.ma50}k | <b>MA200:</b> ${tech.ma200}k\n`;
    msg += `  • <b>Bollinger Bands:</b> ${tech.bollingerBands.lower}k ↔ ${tech.bollingerBands.upper}k\n\n`;

    // 4. Điểm mua & Target
    msg += `🎯 <b>ĐIỂM MUA & TARGET NGẮN HẠN:</b>\n`;
    msg += `  • <b>Vùng mua an toàn:</b> <code>${safeBuy.safeBuyRange.min}k - ${safeBuy.safeBuyRange.max}k</code>\n`;
    msg += `  • <b>Mục tiêu (Target):</b> <code>${safeBuy.targetShortTerm}k</code> (<b>+${gainPct}%</b>)\n`;
    msg += `  • <b>Cắt lỗ (Stop Loss):</b> <code>${safeBuy.stopLoss}k</code> | <b>R/R:</b> 1:${safeBuy.riskRewardShort}\n`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('🏛️ Phân tích Toàn diện /analysis', `analysis:${cleanSym}`),
      ],
      [
        Markup.button.callback('🤖 Gemini AI Phân tích', `ask_ai:${cleanSym}`),
        Markup.button.callback('📰 Tin tức', `news:${cleanSym}`),
      ],
      [
        Markup.button.callback('🏦 Báo cáo tài chính', `fa:${cleanSym}:latest`),
        Markup.button.callback('➕ Thêm vào Watchlist', `wl_add:${cleanSym}`),
      ],
    ]);

    return { text: msg, keyboard };
  }

  /**
   * Phương thức hỗ trợ gửi thông báo tự động từ Cron job tới Telegram Chat (kèm nút bấm nếu có)
   * Tự động chia nhỏ tin nhắn nếu nội dung vượt quá giới hạn Telegram
   */
  async sendMessage(chatId: string, message: string, keyboard?: any) {
    if (!this.bot) return;
    try {
      if (message.length <= 4000) {
        if (keyboard) {
          await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML', ...keyboard });
        } else {
          await this.bot.telegram.sendMessage(chatId, message, { parse_mode: 'HTML' });
        }
      } else {
        // Tách nhỏ tin nhắn theo từng đoạn văn bản
        const chunks = this.splitMessageIntoChunks(message, 3800);
        for (let i = 0; i < chunks.length; i++) {
          const isLast = i === chunks.length - 1;
          if (isLast && keyboard) {
            await this.bot.telegram.sendMessage(chatId, chunks[i], { parse_mode: 'HTML', ...keyboard });
          } else {
            await this.bot.telegram.sendMessage(chatId, chunks[i], { parse_mode: 'HTML' });
          }
        }
      }
    } catch (error) {
      this.logger.error(`Lỗi khi gửi tin nhắn tới Telegram Chat ID ${chatId}: ${error.message}`);
    }
  }

  /**
   * Chia nhỏ chuỗi tin nhắn dài an toàn theo dấu xuống dòng
   */
  private splitMessageIntoChunks(text: string, maxChunkSize = 3800): string[] {
    const chunks: string[] = [];
    let current = '';

    const lines = text.split('\n');
    for (const line of lines) {
      if ((current + '\n' + line).length > maxChunkSize) {
        if (current.trim()) chunks.push(current.trim());
        current = line;
      } else {
        current += (current ? '\n' : '') + line;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }

    return chunks.length > 0 ? chunks : [text];
  }

  /**
   * Gửi ảnh kèm caption tới Telegram chat
   */
  async sendPhoto(chatId: string, photoUrl: string, caption?: string) {
    if (!this.bot) return;
    try {
      await this.bot.telegram.sendPhoto(chatId, { url: photoUrl }, {
        caption: (caption || '').slice(0, 1000),
        parse_mode: 'HTML',
      });
    } catch (error) {
      this.logger.error(`Lỗi khi gửi ảnh tới Telegram Chat ID ${chatId}: ${error.message}`);
    }
  }
}
