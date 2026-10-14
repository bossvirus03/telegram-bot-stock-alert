import { Injectable, Logger, OnModuleInit, OnModuleDestroy, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Telegraf, Markup } from 'telegraf';
import { WatchlistService } from '../watchlist/watchlist.service';
import { MacroService } from '../macro/macro.service';
import { GoldService } from '../gold/gold.service';
import { AlertService } from '../alert/alert.service';
import { IndicatorService } from '../indicator/indicator.service';
import { EmaTimeframe } from '../indicator/indicator.interface';
import { UserXauSettings, XauTimeframe } from '../gold/gold.interface';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf;

  constructor(
    private readonly configService: ConfigService,
    private readonly watchlistService: WatchlistService,
    private readonly macroService: MacroService,
    private readonly goldService: GoldService,
    @Inject(forwardRef(() => AlertService))
    private readonly alertService: AlertService,
    @Inject(forwardRef(() => IndicatorService))
    private readonly indicatorService: IndicatorService,
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
🌐 <b>CHÀO MỪNG ĐẾN VỚI BOT PHÂN TÍCH TÀI CHÍNH, VĨ MÔ & CẢNH BÁO GIÁ</b>

🎯 <b>CẢNH BÁO GIÁ TỨC THÌ (VÀNG, CRYPTO):</b>
• Dùng lệnh <code>/alert MÃ GIÁ</code> (VD: <code>/alert xau 4200</code>, <code>/alert btc 83000</code>, <code>/alert eth 3500</code>)
• Dùng lệnh <code>/alerts</code> để xem & quản lý danh sách cảnh báo giá đang chờ.
  <i>👉 Bot tự động quét liên tục mỗi vài giây và thông báo NGAY LẬP TỨC khi giá thị trường chạm hoặc vượt ngưỡng kỳ vọng!</i>

📈 <b>CẢNH BÁO GIAO CẮT 2 ĐƯỜNG EMA ĐA KHUNG THỜI GIAN:</b>
• Dùng lệnh <code>/ema MÃ KHUNG [FAST] [SLOW]</code> (VD: <code>/ema btc 15m 9 21</code>, <code>/ema xau 1h 20 50</code>, <code>/ema eth 4h 50 200</code>)
• Hoặc gõ <code>/ema</code> để mở menu cài đặt tương tác trực quan với các bộ EMA phổ biến.
• Dùng <code>/ema list</code> để xem & quản lý danh sách cảnh báo EMA đang hoạt động.
  <i>👉 Bot tự động quét và báo NGAY LẬP TỨC khi xảy ra Golden Cross (🟢 Mua) hoặc Death Cross (🔴 Bán)!</i>

🟡 <b>THEO DÕI & CẢNH BÁO VÀNG (XAU/USD):</b>
• Dùng lệnh <code>/gold</code> (hoặc <code>/xau</code>) để xem bảng giá & chỉ số RSI đa khung thời gian (M1 đến D1).
• Dùng lệnh <code>/goldalert</code> để cấu hình cảnh báo khi RSI Vàng chạm vùng Quá Mua / Quá Bán.

🚨 <b>CẢNH BÁO VĨ MÔ TỨC THÌ (CPI/PPI/NFP/FED):</b>
• Dùng lệnh <code>/calendar</code> hoặc <code>/macro</code> để xem lịch sự kiện kinh tế vĩ mô hôm nay.
• Dùng lệnh <code>/settings</code> để chọn mức độ ảnh hưởng của tin tức muốn nhận cảnh báo.
  <i>👉 Bot tự động phát hiện số liệu công bố Actual + Forecast + Previous và báo NGAY LẬP TỨC qua Telegram!</i>

📋 <b>DANH SÁCH CÁC LỆNH TÍNH NĂNG:</b>
📈 <code>/ema</code> - Menu cài đặt & quản lý cảnh báo giao cắt EMA đa khung thời gian
📈 <code>/ema MÃ KHUNG [F] [S]</code> - Đặt nhanh cảnh báo EMA (VD: <code>/ema btc 15m 9 21</code>)
🎯 <code>/alert MÃ GIÁ</code> - Đặt cảnh báo giá Vàng, BTC, ETH... (VD: <code>/alert xau 4200</code>)
📋 <code>/alerts</code> - Quản lý danh sách cảnh báo giá đang hoạt động
🟡 <code>/gold</code> (hoặc <code>/xau</code>, <code>/vang</code>) - Bảng giá & RSI đa khung thời gian Vàng (XAU/USD)
🔔 <code>/goldalert</code> (hoặc <code>/xaualert</code>) - Cài đặt cảnh báo RSI Quá mua/Quá bán Vàng
🌍 <code>/calendar</code> (hoặc <code>/macro</code>) - Lịch sự kiện kinh tế vĩ mô hôm nay (CPI, PPI, NFP, Thất nghiệp...)
⚙️ <code>/settings</code> - Cài đặt bộ lọc mức độ cảnh báo vĩ mô tức thì (Cao/TB/Thấp)
      `.trim();
      await ctx.replyWithHTML(helpMessage);
    });

    // 2. Lệnh /calendar hoặc /macro hoặc /forex - Xem lịch kinh tế vĩ mô hôm nay
    this.bot.command(['calendar', 'macro', 'forex'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      try {
        await ctx.sendChatAction('typing');
        const userLevels = await this.watchlistService.getUserMacroAlertLevels(chatId);
        const text = await this.macroService.getTodayScheduleText(userLevels);
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback('⚙️ Cài đặt bộ lọc vĩ mô', 'macro_open_settings')],
        ]);
        await ctx.replyWithHTML(text, keyboard);
      } catch (error: any) {
        this.logger.error(`Lỗi lệnh /calendar: ${error.message}`);
        await ctx.replyWithHTML(`⚠️ Không thể lấy lịch kinh tế vĩ mô: ${error.message}`);
      }
    });

    // 3. Lệnh /settings hoặc /macro_settings - Cài đặt mức độ ảnh hưởng cảnh báo vĩ mô
    this.bot.command(['settings', 'macro_settings', 'macrosetting', 'setting'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      const levels = await this.watchlistService.getUserMacroAlertLevels(chatId);
      const { text, keyboard } = this.renderMacroSettingsMenu(levels);
      await ctx.replyWithHTML(text, keyboard);
    });

    // Lắng nghe mở menu cài đặt vĩ mô từ nút bấm
    this.bot.action('macro_open_settings', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      await ctx.answerCbQuery();
      const levels = await this.watchlistService.getUserMacroAlertLevels(chatId);
      const { text, keyboard } = this.renderMacroSettingsMenu(levels);
      await ctx.replyWithHTML(text, keyboard);
    });

    // Lắng nghe xem lịch hôm nay từ menu cài đặt
    this.bot.action('macro_view_today', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      await ctx.answerCbQuery('📅 Đang tải lịch sự kiện hôm nay...');
      const userLevels = await this.watchlistService.getUserMacroAlertLevels(chatId);
      const text = await this.macroService.getTodayScheduleText(userLevels);
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Cài đặt bộ lọc vĩ mô', 'macro_open_settings')],
      ]);
      await ctx.replyWithHTML(text, keyboard);
    });

    // Lắng nghe Toggle từng mức độ ảnh hưởng (-1, 0, 1)
    this.bot.action(/^macro_toggle:(-?\d+)$/, async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const level = parseInt(ctx.match[1], 10);
      const updated = await this.watchlistService.toggleUserMacroAlertLevel(chatId, level);
      const isEnabled = updated.includes(level);
      const label = this.macroService.getImpactLabel(level);

      await ctx.answerCbQuery(
        isEnabled ? `✅ Đã BẬT: ${label}` : `❌ Đã TẮT: ${label}`,
      );

      const { text, keyboard } = this.renderMacroSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // Lắng nghe Bật tất cả các mức độ
    this.bot.action('macro_set:all', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const updated = await this.watchlistService.updateUserMacroAlertLevels(chatId, [1, 0, -1]);
      await ctx.answerCbQuery('🔔 Đã BẬT tất cả các mức độ cảnh báo!');
      const { text, keyboard } = this.renderMacroSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // Lắng nghe Khôi phục về mặc định (Cao + Trung bình)
    this.bot.action('macro_set:default', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const updated = await this.watchlistService.updateUserMacroAlertLevels(chatId, [1, 0]);
      await ctx.answerCbQuery('🎯 Đã khôi phục về mặc định: Cao + Trung bình!');
      const { text, keyboard } = this.renderMacroSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // 4. Lệnh /gold hoặc /xau, /vang - Xem bảng giá & RSI đa khung thời gian Vàng XAU/USD
    this.bot.command(['gold', 'xau', 'vang', 'goldrsi', 'xaursi'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      try {
        const overview = await this.goldService.getXauOverview();
        const message = this.goldService.renderOverviewMessage(overview);
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Cập nhật giá & RSI', 'xau_view_overview'),
            Markup.button.callback('⚙️ Cài đặt cảnh báo', 'xau_open_settings'),
          ],
        ]);
        await ctx.replyWithHTML(message, keyboard);
      } catch (e: any) {
        this.logger.error(`Lỗi lệnh /gold: ${e.message}`);
        await ctx.replyWithHTML(`⚠️ Không thể lấy dữ liệu Vàng XAU/USD: ${e.message}`);
      }
    });

    // 5. Lệnh /goldalert hoặc /xaualert - Menu cấu hình cảnh báo RSI Vàng
    this.bot.command(['goldalert', 'xaualert', 'goldsetting', 'xausetting', 'goldsettings'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      const settings = await this.goldService.getUserSettings(chatId);
      const { text, keyboard } = this.renderXauSettingsMenu(settings);
      await ctx.replyWithHTML(text, keyboard);
    });

    // Action: Xem hoặc làm mới bảng RSI Vàng
    this.bot.action('xau_view_overview', async (ctx) => {
      await ctx.answerCbQuery('🔄 Đang tải dữ liệu RSI Vàng mới nhất...');
      try {
        const overview = await this.goldService.getXauOverview(true);
        const message = this.goldService.renderOverviewMessage(overview);
        const keyboard = Markup.inlineKeyboard([
          [
            Markup.button.callback('🔄 Cập nhật giá & RSI', 'xau_view_overview'),
            Markup.button.callback('⚙️ Cài đặt cảnh báo', 'xau_open_settings'),
          ],
        ]);
        try {
          await ctx.editMessageText(message, { parse_mode: 'HTML', ...keyboard });
        } catch (e) {
          await ctx.replyWithHTML(message, keyboard);
        }
      } catch (e: any) {
        await ctx.replyWithHTML(`⚠️ Không thể tải dữ liệu Vàng: ${e.message}`);
      }
    });

    // Action: Mở menu cài đặt cảnh báo Vàng
    this.bot.action('xau_open_settings', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      await ctx.answerCbQuery();
      const settings = await this.goldService.getUserSettings(chatId);
      const { text, keyboard } = this.renderXauSettingsMenu(settings);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Bật/Tắt tổng thể nhận cảnh báo Vàng
    this.bot.action('xau_toggle_master', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const updated = await this.goldService.toggleEnabled(chatId);
      await ctx.answerCbQuery(
        updated.enabled ? '🔔 Đã BẬT nhận cảnh báo RSI Vàng!' : '🔕 Đã TẮT nhận cảnh báo RSI Vàng!',
      );
      const { text, keyboard } = this.renderXauSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // Action: Bật/Tắt một khung thời gian cụ thể (M1, M5, M15, M30, H1, H4, D1)
    this.bot.action(/^xau_toggle_tf:([A-Za-z0-9]+)$/, async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const tf = ctx.match[1] as XauTimeframe;
      const updated = await this.goldService.toggleTimeframe(chatId, tf);
      const isEnabled = updated.timeframes.includes(tf);
      const label = this.goldService.timeframeLabels[tf] || tf;

      await ctx.answerCbQuery(isEnabled ? `✅ Đã BẬT: ${label}` : `❌ Đã TẮT: ${label}`);
      const { text, keyboard } = this.renderXauSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // Action: Chọn bộ ngưỡng RSI (70/30, 75/25, 80/20)
    this.bot.action(/^xau_set_threshold:(\d+)_(\d+)$/, async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const ob = parseInt(ctx.match[1], 10);
      const os = parseInt(ctx.match[2], 10);
      const updated = await this.goldService.setThresholdPreset(chatId, ob, os);
      await ctx.answerCbQuery(`🎯 Đã áp dụng ngưỡng: Quá mua >= ${ob} | Quá bán <= ${os}`);
      const { text, keyboard } = this.renderXauSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // Action: Bật tất cả các khung thời gian
    this.bot.action('xau_set_all_tf', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const updated = await this.goldService.updateUserSettings(chatId, {
        timeframes: ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'],
      });
      await ctx.answerCbQuery('🔔 Đã BẬT tất cả 7 khung thời gian!');
      const { text, keyboard } = this.renderXauSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // Action: Đặt về các khung khuyên dùng (M15, M30, H1, H4, D1)
    this.bot.action('xau_set_default_tf', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const updated = await this.goldService.updateUserSettings(chatId, {
        timeframes: ['M15', 'M30', 'H1', 'H4', 'D1'],
        overboughtRsi: 70,
        oversoldRsi: 30,
      });
      await ctx.answerCbQuery('🎯 Đã khôi phục khung thời gian khuyên dùng (M15, M30, H1, H4, D1)!');
      const { text, keyboard } = this.renderXauSettingsMenu(updated);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {}
    });

    // 6. Lệnh /alert <MÃ> <GIÁ_MỤC_TIÊU> hoặc /alerts hoặc /alert list / del / clear
    this.bot.command(['alert', 'alerts', 'canhbao', 'pricealert', 'alertlist', 'dsalert'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      const text = ctx.message.text.trim();
      const argsStr = text.replace(/^\/(alert|alerts|canhbao|pricealert|alertlist|dsalert)(@\w+)?\s*/i, '').trim();
      const parts = argsStr.split(/\s+/).filter(Boolean);

      // Trường hợp 1: Không có tham số hoặc gõ /alerts hoặc /alert list
      if (parts.length === 0 || parts[0].toLowerCase() === 'list' || parts[0].toLowerCase() === 'ds') {
        const { text: msgText, keyboard } = await this.renderPriceAlertsView(chatId);
        return ctx.replyWithHTML(msgText, keyboard);
      }

      // Trường hợp 2: /alert help hoặc /alert ?
      if (parts[0].toLowerCase() === 'help' || parts[0] === '?') {
        const helpText = `
🎯 <b>HƯỚNG DẪN ĐẶT CẢNH BÁO GIÁ TỨC THÌ</b> 🔔

Bot sẽ theo dõi liên tục giá thị trường và gửi thông báo NGAY LẬP TỨC khi giá chạm hoặc vượt ngưỡng kỳ vọng của bạn!

📌 <b>CÚ PHÁP ĐẶT CẢNH BÁO:</b>
<code>/alert MÃ GIÁ_MỤC_TIÊU</code>

💡 <b>VÍ DỤ CỤ THỂ:</b>
🟡 <b>Vàng (XAU/USD):</b>
• <code>/alert xau 4200</code> <i>(Cảnh báo khi Vàng chạm $4,200)</i>
• <code>/alert gold 2650.5</code>

💎 <b>Tiền điện tử (Crypto):</b>
• <code>/alert btc 83000</code> <i>(Cảnh báo khi Bitcoin đạt $83,000)</i>
• <code>/alert btc 83k</code>
• <code>/alert eth 3500</code>
• <code>/alert sol 220</code>
• <code>/alert pepe 0.000015</code>

📋 <b>CÁC LỆNH QUẢN LÝ:</b>
• <code>/alerts</code> hoặc <code>/alert list</code> - Xem danh sách cảnh báo đang chờ
• <code>/alert del [MÃ_ID]</code> - Hủy một cảnh báo (VD: <code>/alert del 5</code>)
• <code>/alert clear</code> - Hủy toàn bộ cảnh báo của bạn
        `.trim();
        return ctx.replyWithHTML(helpText);
      }

      // Trường hợp 3: /alert del <id> hoặc /alert remove <id> hoặc /alert xoa <id>
      if (['del', 'remove', 'xoa', 'cancel', 'huy'].includes(parts[0].toLowerCase())) {
        if (parts.length < 2) {
          return ctx.replyWithHTML('⚠️ Vui lòng nhập mã ID cảnh báo cần hủy. Ví dụ: <code>/alert del 12</code>');
        }
        if (parts[1].toLowerCase() === 'all' || parts[1].toLowerCase() === 'tatca') {
          const res = await this.alertService.clearUserAlerts(chatId);
          return ctx.replyWithHTML(res.message);
        }
        const alertId = parseInt(parts[1], 10);
        if (isNaN(alertId) || alertId <= 0) {
          return ctx.replyWithHTML('⚠️ Mã ID không hợp lệ. Vui lòng nhập số nguyên dương. Ví dụ: <code>/alert del 12</code>');
        }
        const res = await this.alertService.deleteAlert(chatId, alertId);
        return ctx.replyWithHTML(res.message);
      }

      // Trường hợp 4: /alert clear hoặc /alert del all
      if (parts[0].toLowerCase() === 'clear') {
        const res = await this.alertService.clearUserAlerts(chatId);
        return ctx.replyWithHTML(res.message);
      }

      // Trường hợp 5: /alert <symbol> <targetPrice> (VD: /alert xau 4200 hoặc /alert btc 83000)
      if (parts.length >= 2) {
        const rawSymbol = parts[0];
        const rawTarget = parts[1];

        const waitMsg = await ctx.replyWithHTML(`⏳ Đang kiểm tra giá thị trường cho <b>${rawSymbol.toUpperCase()}</b>...`);

        const result = await this.alertService.createPriceAlert(chatId, username, rawSymbol, rawTarget);

        const keyboard = result.success
          ? Markup.inlineKeyboard([
              [
                Markup.button.callback('📋 Danh sách cảnh báo', 'alert_refresh'),
                Markup.button.callback('➕ Thêm cảnh báo mới', 'alert_new'),
              ],
            ])
          : undefined;

        try {
          if (keyboard) {
            await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, result.message, {
              parse_mode: 'HTML',
              ...keyboard,
            });
          } else {
            await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, result.message, {
              parse_mode: 'HTML',
            });
          }
        } catch (e) {
          await ctx.replyWithHTML(result.message, keyboard);
        }
        return;
      }

      // Trường hợp chỉ nhập 1 tham số mà không phải các từ khóa trên
      return ctx.replyWithHTML(
        `⚠️ Cú pháp chưa đầy đủ. Vui lòng nhập cả mã tài sản và mức giá mục tiêu.\n\n` +
        `Ví dụ:\n` +
        `• <code>/alert xau 4200</code>\n` +
        `• <code>/alert btc 83000</code>\n` +
        `• <code>/alert eth 3500</code>\n\n` +
        `👉 Gõ <code>/alert help</code> để xem hướng dẫn chi tiết.`
      );
    });

    // Action: Làm mới danh sách cảnh báo giá
    this.bot.action('alert_refresh', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      await ctx.answerCbQuery('🔄 Đang cập nhật giá mới nhất...');
      const { text, keyboard } = await this.renderPriceAlertsView(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Hướng dẫn đặt cảnh báo mới
    this.bot.action('alert_new', async (ctx) => {
      await ctx.answerCbQuery();
      const helpText = `
🎯 <b>ĐẶT CẢNH BÁO GIÁ MỚI:</b>

Gõ lệnh theo cú pháp:
<code>/alert MÃ GIÁ_MỤC_TIÊU</code>

💡 <b>Ví dụ mẫu:</b>
• <code>/alert xau 4200</code> <i>(Vàng $4,200)</i>
• <code>/alert btc 83000</code> <i>(Bitcoin $83,000)</i>
• <code>/alert eth 3500</code> <i>(Ethereum $3,500)</i>
• <code>/alert sol 220</code> <i>(Solana $220)</i>
      `.trim();
      await ctx.replyWithHTML(helpText);
    });

    // Action: Xóa một alert cụ thể qua inline button
    this.bot.action(/^alert_del:(\d+)$/, async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const alertId = parseInt(ctx.match[1], 10);
      const res = await this.alertService.deleteAlert(chatId, alertId);
      await ctx.answerCbQuery(res.success ? `🗑 Đã xóa #${alertId}` : '⚠️ Không thể xóa');

      const { text, keyboard } = await this.renderPriceAlertsView(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Xóa tất cả cảnh báo của user
    this.bot.action('alert_clear', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const res = await this.alertService.clearUserAlerts(chatId);
      await ctx.answerCbQuery(`🗑 Đã xóa ${res.count} cảnh báo!`);
      const { text, keyboard } = await this.renderPriceAlertsView(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // 7. Lệnh /ema hoặc /emalert hoặc /emacross - Cài đặt & Quản lý cảnh báo giao cắt EMA đa khung thời gian
    this.bot.command(['ema', 'emalert', 'emacross', 'emasetting', 'emaliston'], async (ctx) => {
      const chatId = ctx.chat.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      await this.watchlistService.registerUser(chatId, username);

      const text = ctx.message.text.trim();
      const argsStr = text.replace(/^\/(ema|emalert|emacross|emasetting|emaliston)(@\w+)?\s*/i, '').trim();
      const parts = argsStr.split(/\s+/).filter(Boolean);

      // Trường hợp 1: Không có tham số -> Mở Menu Cài Đặt EMA chính
      if (parts.length === 0) {
        const { text: msgText, keyboard } = await this.renderEmaMainMenu(chatId);
        return ctx.replyWithHTML(msgText, keyboard);
      }

      // Trường hợp 2: /ema list hoặc /ema ds
      if (['list', 'ds', 'danhsach'].includes(parts[0].toLowerCase())) {
        const { text: msgText, keyboard } = await this.renderEmaAlertsView(chatId);
        return ctx.replyWithHTML(msgText, keyboard);
      }

      // Trường hợp 3: /ema help hoặc /ema ?
      if (['help', '?', 'huongdan'].includes(parts[0].toLowerCase())) {
        const helpText = this.renderEmaHelpText();
        return ctx.replyWithHTML(
          helpText,
          Markup.inlineKeyboard([[Markup.button.callback('⚙️ Mở Menu Cài Đặt EMA', 'ema_menu')]]),
        );
      }

      // Trường hợp 4: /ema del <id> hoặc /ema xoa <id>
      if (['del', 'remove', 'xoa', 'cancel', 'huy'].includes(parts[0].toLowerCase())) {
        if (parts.length < 2) {
          return ctx.replyWithHTML('⚠️ Vui lòng nhập mã ID cảnh báo EMA cần hủy. Ví dụ: <code>/ema del 5</code>');
        }
        if (['all', 'tatca'].includes(parts[1].toLowerCase())) {
          const res = await this.indicatorService.clearUserAlerts(chatId);
          return ctx.replyWithHTML(res.message);
        }
        const alertId = parseInt(parts[1], 10);
        if (isNaN(alertId) || alertId <= 0) {
          return ctx.replyWithHTML('⚠️ Mã ID không hợp lệ. Ví dụ: <code>/ema del 3</code>');
        }
        const res = await this.indicatorService.deleteAlert(chatId, alertId);
        return ctx.replyWithHTML(res.message);
      }

      // Trường hợp 5: /ema clear
      if (parts[0].toLowerCase() === 'clear') {
        const res = await this.indicatorService.clearUserAlerts(chatId);
        return ctx.replyWithHTML(res.message);
      }

      // Trường hợp 6: /ema check <symbol> <timeframe> [fast] [slow] - Kiểm tra trạng thái tức thì
      if (['check', 'status', 'kiemtra'].includes(parts[0].toLowerCase())) {
        if (parts.length < 3) {
          return ctx.replyWithHTML('⚠️ Cú pháp: <code>/ema check MÃ KHUNG [FAST] [SLOW]</code> (VD: <code>/ema check btc 15m 9 21</code>)');
        }
        const rawSym = parts[1];
        const tf = this.indicatorService.normalizeTimeframe(parts[2]);
        if (!tf) {
          return ctx.replyWithHTML(`⚠️ Khung thời gian không hợp lệ. Hỗ trợ: ${this.indicatorService.supportedTimeframes.join(', ')}`);
        }
        const fast = parts[3] ? parseInt(parts[3], 10) : 9;
        const slow = parts[4] ? parseInt(parts[4], 10) : 21;

        const waitMsg = await ctx.replyWithHTML(`⏳ Đang tính toán chỉ số EMA ${fast}/${slow} cho <b>${rawSym.toUpperCase()}</b> [${tf}]...`);
        try {
          const state = await this.indicatorService.getEmaState(rawSym, tf, fast, slow);
          const report = this.formatEmaStateReport(state);
          await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, report, {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback(`🔔 Cài đặt cảnh báo cặp này`, `ema_apply:${state.symbol}:${tf}:${fast}_${slow}`)],
              [Markup.button.callback('⚙️ Menu Cài Đặt EMA', 'ema_menu')],
            ]),
          });
        } catch (e: any) {
          await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, `⚠️ Lỗi: ${e.message}`, { parse_mode: 'HTML' });
        }
        return;
      }

      // Trường hợp 7: Cú pháp trực tiếp: /ema <symbol> <timeframe> [fast] [slow]
      const rawSymbol = parts[0];
      const rawTf = parts[1];

      const tf = this.indicatorService.normalizeTimeframe(rawTf);
      if (!tf) {
        return ctx.replyWithHTML(
          `⚠️ Khung thời gian <b>${rawTf || '(trống)'}</b> không hợp lệ.\n` +
          `Các khung hỗ trợ: <code>M1</code>, <code>M5</code>, <code>M15</code>, <code>M30</code>, <code>H1</code>, <code>H4</code>, <code>D1</code>\n\n` +
          `💡 Ví dụ đặt lệnh:\n` +
          `• <code>/ema btc 15m 9 21</code>\n` +
          `• <code>/ema xau 1h 20 50</code>\n` +
          `• <code>/ema eth 4h 50 200</code>\n\n` +
          `👉 Hoặc chỉ cần gõ <code>/ema</code> để mở menu chọn trực quan!`
        );
      }

      const fastPeriod = parts[2] ? parseInt(parts[2], 10) : 9;
      const slowPeriod = parts[3] ? parseInt(parts[3], 10) : 21;

      if (isNaN(fastPeriod) || isNaN(slowPeriod) || fastPeriod <= 0 || slowPeriod <= 0) {
        return ctx.replyWithHTML('⚠️ Chu kỳ EMA phải là số nguyên dương lớn hơn 0. Ví dụ: 9 và 21.');
      }

      const waitMsg = await ctx.replyWithHTML(
        `⏳ Đang kiểm tra dữ liệu nến và cài đặt cảnh báo <b>EMA ${fastPeriod}/${slowPeriod}</b> cho <b>${rawSymbol.toUpperCase()}</b> [${tf}]...`
      );

      const result = await this.indicatorService.createEmaAlert({
        chatId,
        username,
        symbol: rawSymbol,
        timeframe: tf,
        fastPeriod,
        slowPeriod,
      });

      const keyboard = result.success
        ? Markup.inlineKeyboard([
            [
              Markup.button.callback('📋 Danh sách cảnh báo EMA', 'ema_list'),
              Markup.button.callback('⚙️ Menu Cài Đặt EMA', 'ema_menu'),
            ],
          ])
        : Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ Quay lại Menu EMA', 'ema_menu')],
          ]);

      try {
        await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, result.message, {
          parse_mode: 'HTML',
          ...keyboard,
        });
      } catch (e) {
        await ctx.replyWithHTML(result.message, keyboard);
      }
    });

    // Action: Mở Menu Cài Đặt EMA chính
    this.bot.action('ema_menu', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      await ctx.answerCbQuery();
      const { text, keyboard } = await this.renderEmaMainMenu(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Xem danh sách cảnh báo EMA
    this.bot.action('ema_list', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      await ctx.answerCbQuery('🔄 Đang tải danh sách cảnh báo EMA...');
      const { text, keyboard } = await this.renderEmaAlertsView(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Xóa một cảnh báo EMA theo ID
    this.bot.action(/^ema_del:(\d+)$/, async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const alertId = parseInt(ctx.match[1], 10);
      const res = await this.indicatorService.deleteAlert(chatId, alertId);
      await ctx.answerCbQuery(res.success ? `🗑 Đã xóa #${alertId}` : '⚠️ Không thể xóa');

      const { text, keyboard } = await this.renderEmaAlertsView(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Xóa tất cả cảnh báo EMA
    this.bot.action('ema_clear', async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      if (!chatId) return;
      const res = await this.indicatorService.clearUserAlerts(chatId);
      await ctx.answerCbQuery(`🗑 Đã xóa ${res.count} cảnh báo!`);
      const { text, keyboard } = await this.renderEmaAlertsView(chatId);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Chọn mã tài sản để cài đặt nhanh
    this.bot.action(/^ema_quick:([A-Za-z0-9]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      await ctx.answerCbQuery();
      const { text, keyboard } = this.renderEmaTimeframeSelection(symbol);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Chọn khung thời gian cho mã tài sản
    this.bot.action(/^ema_tf:([A-Za-z0-9]+):([A-Za-z0-9]+)$/, async (ctx) => {
      const symbol = ctx.match[1];
      const tf = ctx.match[2];
      await ctx.answerCbQuery();
      const { text, keyboard } = this.renderEmaPresetSelection(symbol, tf);
      try {
        await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(text, keyboard);
      }
    });

    // Action: Áp dụng cài đặt cảnh báo từ Preset
    this.bot.action(/^ema_apply:([A-Za-z0-9]+):([A-Za-z0-9]+):(\d+)_(\d+)$/, async (ctx) => {
      const chatId = ctx.chat?.id.toString();
      const username = ctx.from?.username || ctx.from?.first_name;
      if (!chatId) return;

      const symbol = ctx.match[1];
      const tf = ctx.match[2] as EmaTimeframe;
      const fast = parseInt(ctx.match[3], 10);
      const slow = parseInt(ctx.match[4], 10);

      await ctx.answerCbQuery(`⏳ Đang khởi tạo EMA ${fast}/${slow}...`);

      const result = await this.indicatorService.createEmaAlert({
        chatId,
        username,
        symbol,
        timeframe: tf,
        fastPeriod: fast,
        slowPeriod: slow,
      });

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📋 Danh sách cảnh báo EMA', 'ema_list'),
          Markup.button.callback('⚙️ Menu Cài Đặt EMA', 'ema_menu'),
        ],
      ]);

      try {
        await ctx.editMessageText(result.message, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(result.message, keyboard);
      }
    });

    // Action: Xem hướng dẫn sử dụng EMA
    this.bot.action('ema_help', async (ctx) => {
      await ctx.answerCbQuery();
      const helpText = this.renderEmaHelpText();
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('⚙️ Mở Menu Cài Đặt EMA', 'ema_menu')],
      ]);
      try {
        await ctx.editMessageText(helpText, { parse_mode: 'HTML', ...keyboard });
      } catch (e) {
        await ctx.replyWithHTML(helpText, keyboard);
      }
    });
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
    } catch (error: any) {
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

  /**
   * Tạo nội dung giao diện HTML và inline keyboard cho menu cài đặt bộ lọc vĩ mô
   */
  private renderMacroSettingsMenu(levels: number[]) {
    const isHigh = levels.includes(1);
    const isMedium = levels.includes(0);
    const isLow = levels.includes(-1);

    const activeCount = levels.length;
    let summaryTag = '';
    if (activeCount === 3) {
      summaryTag = '🔔 <b>BẬT TẤT CẢ (3/3 mức)</b>';
    } else if (activeCount === 0) {
      summaryTag = '🔕 <b>ĐANG TẮT TẤT CẢ (Tạm ngưng nhận tin vĩ mô)</b>';
    } else {
      summaryTag = `🎯 <b>ĐANG BẬT ${activeCount}/3 mức</b>`;
    }

    const text = `
⚙️ <b>CÀI ĐẶT BỘ LỌC CẢNH BÁO VĨ MÔ TỨC THÌ</b>
${summaryTag}

<i>Chọn các mức độ ảnh hưởng của sự kiện kinh tế bạn muốn nhận thông báo tức thì (Real-time Instant Alert) khi vừa công bố số liệu Thực tế (Actual):</i>

• ⭐⭐⭐ <b>Cao (High Impact):</b> ${isHigh ? '🟢 <b>BẬT</b>' : '⚪ <b>TẮT</b>'}
  <i>(Fed lãi suất, CPI, Non-Farm Payrolls NFP, GDP...)</i>

• ⭐⭐ <b>Trung bình (Medium Impact):</b> ${isMedium ? '🟢 <b>BẬT</b>' : '⚪ <b>TẮT</b>'}
  <i>(PPI, Đơn trợ cấp thất nghiệp Jobless claims, Doanh số bán lẻ, PMI...)</i>

• ⭐ <b>Thấp (Low Impact):</b> ${isLow ? '🟢 <b>BẬT</b>' : '⚪ <b>TẮT</b>'}
  <i>(Đấu thầu trái phiếu, các khảo sát nhỏ...)</i>

💡 <i>Nhấn vào các nút bên dưới để Bật/Tắt từng mức độ theo mong muốn:</i>
    `.trim();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(
          `${isHigh ? '✅' : '❌'} ⭐⭐⭐ Cao (High Impact)`,
          'macro_toggle:1',
        ),
      ],
      [
        Markup.button.callback(
          `${isMedium ? '✅' : '❌'} ⭐⭐ Trung bình (Medium Impact)`,
          'macro_toggle:0',
        ),
      ],
      [
        Markup.button.callback(
          `${isLow ? '✅' : '❌'} ⭐ Thấp (Low Impact)`,
          'macro_toggle:-1',
        ),
      ],
      [
        Markup.button.callback('🔔 Bật tất cả', 'macro_set:all'),
        Markup.button.callback('🎯 Mặc định (Cao + TB)', 'macro_set:default'),
      ],
      [
        Markup.button.callback('📅 Xem lịch kinh tế hôm nay', 'macro_view_today'),
      ],
    ]);

    return { text, keyboard };
  }

  /**
   * Tạo nội dung giao diện HTML và inline keyboard cho menu cài đặt cảnh báo RSI Vàng XAU/USD
   */
  private renderXauSettingsMenu(settings: UserXauSettings) {
    const isMasterOn = settings.enabled;
    const tfs = settings.timeframes;

    const isM1 = tfs.includes('M1');
    const isM5 = tfs.includes('M5');
    const isM15 = tfs.includes('M15');
    const isM30 = tfs.includes('M30');
    const isH1 = tfs.includes('H1');
    const isH4 = tfs.includes('H4');
    const isD1 = tfs.includes('D1');

    const isPreset70 = settings.overboughtRsi === 70 && settings.oversoldRsi === 30;
    const isPreset75 = settings.overboughtRsi === 75 && settings.oversoldRsi === 25;
    const isPreset80 = settings.overboughtRsi === 80 && settings.oversoldRsi === 20;

    let statusHeader = '';
    if (!isMasterOn) {
      statusHeader = '🔕 <b>TRẠNG THÁI: TẮT CẢNH BÁO</b> (Không nhận thông báo RSI)';
    } else {
      statusHeader = `🔔 <b>TRẠNG THÁI: ĐANG BẬT</b> (${tfs.length}/7 khung được kích hoạt)`;
    }

    let text = `⚙️ <b>CÀI ĐẶT CẢNH BÁO RSI VÀNG (XAU/USD)</b>\n`;
    text += `${statusHeader}\n\n`;
    text += `<i>Hệ thống tự động quét và gửi tin nhắn tức thì khi RSI của XAU/USD chạm hoặc vượt vùng Quá Mua / Quá Bán trên các khung thời gian bạn chọn:</i>\n\n`;

    text += `⏳ <b>Các khung thời gian đang kích hoạt:</b>\n`;
    text += `• M1 (1 Phút): ${isM1 ? '🟢 Bật' : '⚪ Tắt'}\n`;
    text += `• M5 (5 Phút): ${isM5 ? '🟢 Bật' : '⚪ Tắt'}\n`;
    text += `• M15 (15 Phút): ${isM15 ? '🟢 Bật' : '⚪ Tắt'}\n`;
    text += `• M30 (30 Phút): ${isM30 ? '🟢 Bật' : '⚪ Tắt'}\n`;
    text += `• H1 (1 Giờ): ${isH1 ? '🟢 Bật' : '⚪ Tắt'}\n`;
    text += `• H4 (4 Giờ): ${isH4 ? '🟢 Bật' : '⚪ Tắt'}\n`;
    text += `• D1 (1 Ngày): ${isD1 ? '🟢 Bật' : '⚪ Tắt'}\n\n`;

    text += `🎯 <b>Ngưỡng kích hoạt:</b> Quá Mua ≥ <code>${settings.overboughtRsi}</code> | Quá Bán ≤ <code>${settings.oversoldRsi}</code>\n\n`;
    text += `💡 <i>Bấm vào các nút bên dưới để Bật/Tắt từng khung hoặc chọn bộ ngưỡng nhanh:</i>`;

    const keyboard = Markup.inlineKeyboard([
      // Hàng 1: Nút Master On/Off
      [
        Markup.button.callback(
          isMasterOn ? '🔕 TẮT TẤT CẢ CẢNH BÁO' : '🔔 BẬT NHẬN CẢNH BÁO',
          'xau_toggle_master',
        ),
      ],
      // Hàng 2: Khung ngắn hạn
      [
        Markup.button.callback(`${isM1 ? '✅' : '❌'} M1 (1p)`, 'xau_toggle_tf:M1'),
        Markup.button.callback(`${isM5 ? '✅' : '❌'} M5 (5p)`, 'xau_toggle_tf:M5'),
        Markup.button.callback(`${isM15 ? '✅' : '❌'} M15 (15p)`, 'xau_toggle_tf:M15'),
      ],
      // Hàng 3: Khung trung & dài hạn
      [
        Markup.button.callback(`${isM30 ? '✅' : '❌'} M30`, 'xau_toggle_tf:M30'),
        Markup.button.callback(`${isH1 ? '✅' : '❌'} H1 (1h)`, 'xau_toggle_tf:H1'),
        Markup.button.callback(`${isH4 ? '✅' : '❌'} H4 (4h)`, 'xau_toggle_tf:H4'),
        Markup.button.callback(`${isD1 ? '✅' : '❌'} D1 (1d)`, 'xau_toggle_tf:D1'),
      ],
      // Hàng 4: Chọn ngưỡng RSI
      [
        Markup.button.callback(`${isPreset70 ? '🔘' : '⚪'} 70 / 30 (Chuẩn)`, 'xau_set_threshold:70_30'),
        Markup.button.callback(`${isPreset75 ? '🔘' : '⚪'} 75 / 25 (Lọc nhiễu)`, 'xau_set_threshold:75_25'),
        Markup.button.callback(`${isPreset80 ? '🔘' : '⚪'} 80 / 20 (Cực trị)`, 'xau_set_threshold:80_20'),
      ],
      // Hàng 5: Nút thiết lập nhanh
      [
        Markup.button.callback('🔔 Bật tất cả 7 khung', 'xau_set_all_tf'),
        Markup.button.callback('🎯 Khuyên dùng (M15-D1)', 'xau_set_default_tf'),
      ],
      // Hàng 6: Xem bảng giá Vàng
      [Markup.button.callback('📊 Xem bảng giá & RSI Vàng ngay', 'xau_view_overview')],
    ]);

    return { text, keyboard };
  }

  /**
   * Tạo nội dung HTML và inline keyboard cho danh sách các cảnh báo giá đang chờ của User
   */
  private async renderPriceAlertsView(chatId: string): Promise<{ text: string; keyboard: any }> {
    const activeAlerts = await this.alertService.getUserActiveAlerts(chatId);

    if (activeAlerts.length === 0) {
      const text = `
📭 <b>BẠN CHƯA CÓ CẢNH BÁO GIÁ NÀO ĐANG HOẠT ĐỘNG</b>

💡 <b>Cách đặt cảnh báo giá tức thì:</b>
• 🟡 <b>Vàng:</b> <code>/alert xau 4200</code>
• 💎 <b>Crypto:</b> <code>/alert btc 83000</code> | <code>/alert eth 3500</code> | <code>/alert sol 220</code>

<i>👉 Bot sẽ quét liên tục mỗi vài giây và thông báo ngay khi giá chạm hoặc vượt ngưỡng kỳ vọng!</i>
      `.trim();

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Hướng dẫn đặt cảnh báo', 'alert_new')],
      ]);

      return { text, keyboard };
    }

    let text = `🔔 <b>DANH SÁCH CẢNH BÁO GIÁ ĐANG CHỜ (${activeAlerts.length})</b>\n\n`;

    const deleteButtons: any[] = [];

    activeAlerts.forEach((item, index) => {
      const alert = item.alert;
      const condIcon = alert.condition === 'ABOVE' ? '🚀 ≥' : '🔻 ≤';
      const assetIcon = alert.assetType === 'GOLD' ? '🟡' : '💎';

      text += `<b>${index + 1}. ${assetIcon} ${alert.displaySymbol}</b> <code>(#${alert.id})</code>\n`;
      text += `• 🎯 <b>Giá đặt cảnh báo:</b> <code>${item.formattedTargetPrice}</code> (${condIcon})\n`;
      text += `• 💵 <b>Giá thị trường hiện tại:</b> <code>${item.formattedCurrentPrice}</code>\n`;
      text += `• 📊 <b>Biến động:</b> <b>${item.distanceText}</b> <i>(lúc đặt: ${item.formattedInitialPrice})</i>\n\n`;

      deleteButtons.push(
        Markup.button.callback(`🗑 Hủy #${alert.id} (${alert.symbol}) - ${item.formattedTargetPrice}`, `alert_del:${alert.id}`)
      );
    });

    text += `<i>💡 Bấm vào nút bên dưới để hủy cảnh báo tương ứng:</i>`;

    // Sắp xếp các nút hủy thành các hàng (mỗi hàng 1 nút hoặc 2 nút tuỳ độ dài text)
    const buttonRows: any[][] = [];
    for (let i = 0; i < deleteButtons.length; i++) {
      buttonRows.push([deleteButtons[i]]);
    }

    // Hàng nút điều khiển chung
    buttonRows.push([
      Markup.button.callback('🔄 Làm mới giá', 'alert_refresh'),
      Markup.button.callback('🗑 Hủy tất cả', 'alert_clear'),
    ]);
    buttonRows.push([
      Markup.button.callback('➕ Đặt thêm cảnh báo', 'alert_new'),
    ]);

    const keyboard = Markup.inlineKeyboard(buttonRows);

    return { text, keyboard };
  }

  /**
   * Tạo nội dung HTML và keyboard cho Menu Cài Đặt EMA chính
   */
  private async renderEmaMainMenu(chatId: string): Promise<{ text: string; keyboard: any }> {
    const activeAlerts = await this.indicatorService.getUserActiveAlerts(chatId);
    const count = activeAlerts.length;

    const text = `
📈 <b>CÀI ĐẶT CẢNH BÁO GIAO CẮT 2 ĐƯỜNG EMA</b> 🎯
<i>(Exponential Moving Average Crossover Alert)</i>

Bot tự động theo dõi liên tục biểu đồ kỹ thuật và phát thông báo <b>NGAY LẬP TỨC</b> khi 2 đường EMA cắt nhau:
• 🟢 <b>Golden Cross (Cắt Lên):</b> Đường ngắn vượt lên trên đường dài 👉 Báo hiệu xu hướng <b>TĂNG (MUA)</b>.
• 🔴 <b>Death Cross (Cắt Xuống):</b> Đường ngắn cắt xuống dưới đường dài 👉 Báo hiệu xu hướng <b>GIẢM (BÁN)</b>.

📊 <b>Trạng thái của bạn:</b> Đang bật <b>${count}</b> cảnh báo EMA.

💡 <b>Chọn nhanh tài sản bên dưới hoặc gõ lệnh:</b>
<code>/ema MÃ KHUNG [FAST] [SLOW]</code>
<i>(VD: <code>/ema btc 15m 9 21</code>, <code>/ema xau 1h 20 50</code>, <code>/ema eth 4h 50 200</code>)</i>
    `.trim();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback(`📋 Danh sách cảnh báo của bạn (${count})`, 'ema_list'),
      ],
      [
        Markup.button.callback('🟡 Vàng (XAU/USD)', 'ema_quick:XAU'),
        Markup.button.callback('₿ Bitcoin (BTC)', 'ema_quick:BTC'),
      ],
      [
        Markup.button.callback('💎 Ethereum (ETH)', 'ema_quick:ETH'),
        Markup.button.callback('🟣 Solana (SOL)', 'ema_quick:SOL'),
      ],
      [
        Markup.button.callback('❓ Hướng dẫn chi tiết', 'ema_help'),
        Markup.button.callback('🔄 Làm mới Menu', 'ema_menu'),
      ],
    ]);

    return { text, keyboard };
  }

  /**
   * Tạo giao diện xem và quản lý danh sách các cảnh báo EMA của user
   */
  private async renderEmaAlertsView(chatId: string): Promise<{ text: string; keyboard: any }> {
    const activeAlerts = await this.indicatorService.getUserActiveAlerts(chatId);

    if (activeAlerts.length === 0) {
      const text = `
📭 <b>BẠN CHƯA CÓ CẢNH BÁO GIAO CẮT EMA NÀO</b>

Hệ thống cho phép bạn đặt cảnh báo khi 2 đường EMA bất kỳ cắt nhau trên mọi khung thời gian (M1 đến D1).

💡 <b>Cách cài đặt nhanh:</b>
• 🟡 Vàng 1 Giờ (EMA 20/50): <code>/ema xau 1h 20 50</code>
• ₿ Bitcoin 15 Phút (EMA 9/21): <code>/ema btc 15m 9 21</code>
• 💎 Ethereum 4 Giờ (EMA 50/200): <code>/ema eth 4h 50 200</code>

<i>👉 Hoặc bấm vào nút bên dưới để chọn trực quan:</i>
      `.trim();

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('➕ Cài đặt cảnh báo EMA mới', 'ema_menu')],
      ]);

      return { text, keyboard };
    }

    let text = `🔔 <b>DANH SÁCH CẢNH BÁO EMA ĐANG HOẠT ĐỘNG (${activeAlerts.length})</b>\n\n`;

    const deleteButtons: any[] = [];

    activeAlerts.forEach((item, index) => {
      const alert = item.alert;
      const tfLabel = this.indicatorService.timeframeLabels[alert.timeframe as EmaTimeframe] || alert.timeframe;

      text += `<b>${index + 1}. 📈 ${alert.displaySymbol}</b> <code>(#${alert.id})</code>\n`;
      text += `• ⏳ <b>Khung:</b> <code>${tfLabel}</code>\n`;
      text += `• 📊 <b>Cặp EMA:</b> <b>EMA ${alert.fastPeriod}</b> & <b>EMA ${alert.slowPeriod}</b>\n`;
      text += `• 🏷️ <b>Hiện trạng:</b> ${item.statusText}\n`;
      if (item.state) {
        text += `• 💵 <b>Giá hiện tại:</b> <code>${this.indicatorService.formatPrice(item.state.currentPrice, alert.assetType)}</code>\n`;
      }
      if (alert.lastTriggeredAt) {
        const timeStr = new Intl.DateTimeFormat('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
          hour: '2-digit',
          minute: '2-digit',
          day: '2-digit',
          month: '2-digit',
        }).format(new Date(alert.lastTriggeredAt));
        text += `• ⚡ <b>Cắt lần cuối:</b> <code>${alert.lastCrossType}</code> (${timeStr})\n`;
      }
      text += `\n`;

      deleteButtons.push(
        Markup.button.callback(`🗑 Hủy #${alert.id} (${alert.symbol} [${alert.timeframe}] EMA ${alert.fastPeriod}/${alert.slowPeriod})`, `ema_del:${alert.id}`)
      );
    });

    text += `<i>💡 Bấm vào nút bên dưới để hủy cảnh báo tương ứng:</i>`;

    const buttonRows: any[][] = [];
    for (let i = 0; i < deleteButtons.length; i++) {
      buttonRows.push([deleteButtons[i]]);
    }

    buttonRows.push([
      Markup.button.callback('🔄 Cập nhật trạng thái', 'ema_list'),
      Markup.button.callback('🗑 Hủy tất cả', 'ema_clear'),
    ]);
    buttonRows.push([
      Markup.button.callback('➕ Cài đặt thêm cảnh báo', 'ema_menu'),
    ]);

    const keyboard = Markup.inlineKeyboard(buttonRows);

    return { text, keyboard };
  }

  /**
   * Menu chọn khung thời gian cho 1 mã tài sản
   */
  private renderEmaTimeframeSelection(symbol: string): { text: string; keyboard: any } {
    const text = `
⏳ <b>CHỌN KHUNG THỜI GIAN CHO ${symbol.toUpperCase()}</b>

<i>Vui lòng chọn khung thời gian (Timeframe) bạn muốn bot theo dõi giao cắt EMA:</i>
    `.trim();

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('⚡ 1 Phút (M1)', `ema_tf:${symbol}:M1`),
        Markup.button.callback('⚡ 5 Phút (M5)', `ema_tf:${symbol}:M5`),
        Markup.button.callback('🎯 15 Phút (M15)', `ema_tf:${symbol}:M15`),
      ],
      [
        Markup.button.callback('🎯 30 Phút (M30)', `ema_tf:${symbol}:M30`),
        Markup.button.callback('🔥 1 Giờ (H1)', `ema_tf:${symbol}:H1`),
        Markup.button.callback('🔥 4 Giờ (H4)', `ema_tf:${symbol}:H4`),
      ],
      [
        Markup.button.callback('📅 1 Ngày (D1)', `ema_tf:${symbol}:D1`),
      ],
      [
        Markup.button.callback('🔙 Quay lại Menu', 'ema_menu'),
      ],
    ]);

    return { text, keyboard };
  }

  /**
   * Menu chọn bộ thông số EMA cho 1 mã tài sản và khung thời gian
   */
  private renderEmaPresetSelection(symbol: string, timeframe: string): { text: string; keyboard: any } {
    const tfLabel = this.indicatorService.timeframeLabels[timeframe as EmaTimeframe] || timeframe;

    const text = `
📈 <b>CHỌN BỘ CHỈ BÁO EMA CHO ${symbol.toUpperCase()} [${tfLabel}]</b>

<i>Chọn một trong các bộ thông số EMA phổ biến được nhiều chuyên gia tin dùng nhất:</i>
    `.trim();

    const buttons: any[] = this.indicatorService.presets.map((p) => [
      Markup.button.callback(
        `🎯 ${p.name} - ${p.description}`,
        `ema_apply:${symbol}:${timeframe}:${p.fast}_${p.slow}`,
      ),
    ]);

    buttons.push([
      Markup.button.callback(`🔙 Chọn lại khung`, `ema_quick:${symbol}`),
      Markup.button.callback('🔙 Menu chính', 'ema_menu'),
    ]);

    const keyboard = Markup.inlineKeyboard(buttons);

    return { text, keyboard };
  }

  /**
   * Tạo văn bản hướng dẫn sử dụng tính năng EMA
   */
  private renderEmaHelpText(): string {
    return `
📈 <b>HƯỚNG DẪN CÀI ĐẶT CẢNH BÁO 2 ĐƯỜNG EMA CẮT NHAU</b> 🎯

<b>1. Ý NGHĨA KỸ THUẬT:</b>
• 🟢 <b>Golden Cross (Cắt Lên):</b> Đường EMA ngắn cắt lên trên đường EMA dài. Xác nhận động lực tăng giá mạnh mẽ, tín hiệu MUA vào.
• 🔴 <b>Death Cross (Cắt Xuống):</b> Đường EMA ngắn cắt xuống dưới đường EMA dài. Xác nhận động lực suy yếu, tín hiệu BÁN ra hoặc phòng thủ.

<b>2. CÚ PHÁP LỆNH GÕ NHANH:</b>
<code>/ema MÃ KHUNG [FAST] [SLOW]</code>

<b>3. CÁC VÍ DỤ CỤ THỂ:</b>
• 🟡 <b>Vàng (XAU/USD):</b>
  - <code>/ema xau 15m 9 21</code> <i>(Lướt sóng Vàng ngắn hạn 15p)</i>
  - <code>/ema xau 1h 20 50</code> <i>(Bắt sóng xu hướng Vàng 1h)</i>

• ₿ <b>Bitcoin (BTC):</b>
  - <code>/ema btc 15m 9 21</code>
  - <code>/ema btc 4h 50 200</code> <i>(Golden / Death Cross lịch sử)</i>

• 💎 <b>Ethereum & Altcoins:</b>
  - <code>/ema eth 1h 20 50</code>
  - <code>/ema sol 30m 9 21</code>
  - <code>/ema bnb 4h 50 200</code>

<b>4. QUẢN LÝ CẢNH BÁO:</b>
• <code>/ema</code> - Mở Menu cài đặt trực quan dạng nút bấm
• <code>/ema list</code> - Xem danh sách cảnh báo đang chạy
• <code>/ema check MÃ KHUNG [F] [S]</code> - Kiểm tra trạng thái EMA hiện tại
• <code>/ema del ID</code> - Hủy 1 cảnh báo (VD: <code>/ema del 3</code>)
• <code>/ema clear</code> - Hủy toàn bộ cảnh báo EMA của bạn
    `.trim();
  }

  /**
   * Tạo báo cáo định dạng trạng thái EMA kiểm tra tức thì
   */
  private formatEmaStateReport(state: any): string {
    const isBull = state.trend === 'BULLISH';
    const trendIcon = isBull ? '🟢' : '🔴';
    const trendLabel = isBull ? 'ĐANG NẰM TRÊN (Xu hướng Tăng)' : 'ĐANG NẰM DƯỚI (Xu hướng Giảm)';

    const tfLabel = this.indicatorService.timeframeLabels[state.timeframe as EmaTimeframe] || state.timeframe;

    return `
📊 <b>KẾT QUẢ ĐO CHỈ BÁO EMA - ${state.displaySymbol}</b>

⏳ <b>Khung thời gian:</b> <b>${tfLabel}</b>
💵 <b>Giá khớp hiện tại:</b> <code>${this.indicatorService.formatPrice(state.currentPrice, state.assetType)}</code>

📈 <b>THÔNG SỐ 2 ĐƯỜNG EMA:</b>
• 🟢 EMA(${state.fastPeriod}): <code>${this.indicatorService.formatPrice(state.fastValue, state.assetType)}</code>
• 🔴 EMA(${state.slowPeriod}): <code>${this.indicatorService.formatPrice(state.slowValue, state.assetType)}</code>
• 🏷️ Trạng thái: ${trendIcon} <b>EMA ${state.fastPeriod}</b> ${trendLabel}
• 📊 Chênh lệch: <b>${state.diffPercent > 0 ? '+' : ''}${state.diffPercent}%</b>

${state.crossDetected ? `⚡ <b>VỪA XẢY RA GIAO CẮT:</b> <b>${state.crossDetected === 'BULLISH' ? '🟢 GOLDEN CROSS' : '🔴 DEATH CROSS'}</b> tại nhịp này!` : '⚪ <i>Chưa có giao cắt mới ở nến hiện tại.</i>'}
    `.trim();
  }
}

