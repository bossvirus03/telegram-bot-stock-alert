import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EconomicEvent, MacroAnalysisResult } from './macro.interface';

@Injectable()
export class MacroService {
  private readonly logger = new Logger(MacroService.name);

  // Bộ nhớ đệm in-memory lưu các eventId đã thông báo để tra cứu microsecond
  private readonly alertedEventIds = new Set<string>();

  // Cache danh sách sự kiện trong ngày (cập nhật thường xuyên)
  private cachedEvents: EconomicEvent[] = [];
  private lastFetchedTime = 0;

  constructor(private readonly prisma: PrismaService) {
    this.loadHistoricalAlerts().catch((err) => {
      this.logger.error(`Lỗi tải lịch sử cảnh báo vĩ mô từ database: ${err.message}`);
    });
  }

  /**
   * Nạp lịch sử các cảnh báo đã gửi từ DB vào Memory để tránh phát lại khi restart server
   */
  private async loadHistoricalAlerts() {
    try {
      const logs = await this.prisma.macroAlertLog.findMany({
        select: { eventId: true },
        take: 2000,
        orderBy: { createdAt: 'desc' },
      });
      logs.forEach((log) => this.alertedEventIds.add(log.eventId));
      this.logger.log(`📥 Đã nạp ${this.alertedEventIds.size} sự kiện vĩ mô đã gửi từ database.`);
    } catch (e: any) {
      this.logger.warn(`Chưa thể đọc bảng macro_alert_logs: ${e.message}`);
    }
  }

  /**
   * Lấy cờ quốc gia tương ứng với mã country
   */
  getCountryFlag(countryCode: string): string {
    const flags: Record<string, string> = {
      US: '🇺🇸',
      EU: '🇪🇺',
      GB: '🇬🇧',
      JP: '🇯🇵',
      CN: '🇨🇳',
      VN: '🇻🇳',
      DE: '🇩🇪',
      FR: '🇫🇷',
      CA: '🇨🇦',
      AU: '🇦🇺',
      CH: '🇨🇭',
      NZ: '🇳🇿',
    };
    return flags[countryCode?.toUpperCase()] || '🌐';
  }

  /**
   * Lấy dữ liệu lịch kinh tế từ TradingView Economic Calendar API (Độ trễ thấp, cập nhật tức thì)
   */
  async fetchEvents(fromDate?: Date, toDate?: Date): Promise<EconomicEvent[]> {
    const now = new Date();
    // Mặc định lấy từ đầu ngày hôm nay (00:00:00 UTC) đến hết ngày mai (+36h)
    const from = fromDate || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
    const to = toDate || new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 23, 59, 59));

    const url = `https://economic-calendar.tradingview.com/events?from=${encodeURIComponent(
      from.toISOString(),
    )}&to=${encodeURIComponent(to.toISOString())}`;

    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          Origin: 'https://www.tradingview.com',
          Referer: 'https://www.tradingview.com/',
        },
        timeout: 8000,
      });

      if (res.data && Array.isArray(res.data.result)) {
        const events: EconomicEvent[] = res.data.result.map((item: any) => ({
          id: String(item.id),
          title: item.title,
          country: item.country,
          indicator: item.indicator,
          date: item.date,
          actual: item.actual !== undefined ? item.actual : null,
          forecast: item.forecast !== undefined ? item.forecast : null,
          previous: item.previous !== undefined ? item.previous : null,
          unit: item.unit || '',
          importance: typeof item.importance === 'number' ? item.importance : 0,
          currency: item.currency,
          comment: item.comment,
          source: item.source,
        }));

        this.cachedEvents = events;
        this.lastFetchedTime = Date.now();
        return events;
      }
      return this.cachedEvents;
    } catch (err: any) {
      this.logger.error(`Lỗi fetch economic calendar: ${err.message}`);
      return this.cachedEvents;
    }
  }

  /**
   * Trả về nhãn mô tả mức độ ảnh hưởng tương ứng với giá trị importance
   */
  getImpactLabel(importance: number): string {
    if (importance === 1) return '⭐⭐⭐ Cao (High Impact)';
    if (importance === -1) return '⭐ Thấp (Low Impact)';
    return '⭐⭐ Trung bình (Medium Impact)';
  }

  /**
   * Lọc ra các sự kiện then chốt theo các mức độ ảnh hưởng (allowedImportances: 1, 0, -1)
   */
  filterKeyEvents(events: EconomicEvent[], allowedImportances?: number[]): EconomicEvent[] {
    const keyKeywords = [
      'cpi',
      'consumer price index',
      'core cpi',
      'ppi',
      'producer price index',
      'core ppi',
      'pce',
      'core pce',
      'non farm payrolls',
      'nonfarm payrolls',
      'payrolls',
      'unemployment rate',
      'initial jobless claims',
      'jobless claims',
      'interest rate',
      'fed funds',
      'fomc',
      'gdp',
      'retail sales',
      'ism manufacturing',
      'ism services',
      'michigan consumer',
    ];

    const majorCountries = ['US', 'EU', 'GB', 'JP', 'CN', 'VN', 'DE'];

    return events.filter((e) => {
      const countryCode = (e.country || '').toUpperCase();
      const isMajorCountry = majorCountries.includes(countryCode);
      if (!isMajorCountry) return false;

      // Nếu có truyền danh sách allowedImportances thì bắt buộc importance phải thuộc danh sách đó
      if (allowedImportances && allowedImportances.length > 0) {
        if (!allowedImportances.includes(e.importance)) {
          return false;
        }
      }

      const titleLower = (e.title || '').toLowerCase();
      const indicatorLower = (e.indicator || '').toLowerCase();
      const isKeyIndicator = keyKeywords.some(
        (kw) => titleLower.includes(kw) || indicatorLower.includes(kw),
      );

      // Nếu là High Impact (1) hoặc Medium Impact (0) hoặc từ khóa vĩ mô trọng yếu
      if (e.importance === 1 || e.importance === 0 || isKeyIndicator) return true;

      // Nếu người dùng bật mức Thấp (-1)
      if (allowedImportances?.includes(-1) && e.importance === -1) return true;

      // Mặc định cho phép tất cả các sự kiện nếu không chỉ định allowedImportances cụ thể
      if (!allowedImportances) return true;

      return false;
    });
  }

  /**
   * Kiểm tra xem hiện tại có sự kiện nào sắp diễn ra (trong vòng 5 phút)
   * hoặc vừa diễn ra cách đây dưới 15 phút mà chưa có kết quả Actual không.
   * => Dùng để kích hoạt chế độ Fast Polling (3 - 5 giây / lần)
   */
  hasPendingEventsNearRelease(events: EconomicEvent[]): boolean {
    const nowMs = Date.now();
    // Chỉ kích hoạt Fast Polling với các tin High & Medium trọng yếu
    const keyEvents = this.filterKeyEvents(events, [1, 0]);

    return keyEvents.some((e) => {
      // Nếu đã có kết quả và đã báo rồi thì bỏ qua
      if (this.alertedEventIds.has(e.id)) return false;

      const eventTimeMs = new Date(e.date).getTime();
      const diffMinutes = (eventTimeMs - nowMs) / (60 * 1000);

      // Sắp ra trong 5 phút tới (-5 phút) hoặc đã tới giờ ra tin nhưng chưa quá 15 phút mà chưa có actual
      const isImminent = diffMinutes <= 5 && diffMinutes >= -15;
      const isAwaitingActual = e.actual === null || e.actual === undefined;

      return isImminent && isAwaitingActual;
    });
  }

  /**
   * Tìm các sự kiện quan trọng vừa có kết quả Actual mà chưa từng được báo
   */
  getNewlyReleasedEvents(events: EconomicEvent[], allowedImportances?: number[]): EconomicEvent[] {
    const keyEvents = this.filterKeyEvents(events, allowedImportances);

    return keyEvents.filter((e) => {
      // Đã có Actual
      const hasActual = e.actual !== null && e.actual !== undefined && e.actual !== '';
      // Chưa từng thông báo
      const notAlerted = !this.alertedEventIds.has(e.id);

      return hasActual && notAlerted;
    });
  }

  /**
   * Đánh dấu sự kiện đã thông báo và lưu vào Database
   */
  async markEventAsAlerted(event: EconomicEvent): Promise<void> {
    this.alertedEventIds.add(event.id);

    try {
      await this.prisma.macroAlertLog.upsert({
        where: { eventId: event.id },
        update: {
          actual: String(event.actual ?? ''),
          forecast: event.forecast !== null && event.forecast !== undefined ? String(event.forecast) : null,
          previous: event.previous !== null && event.previous !== undefined ? String(event.previous) : null,
        },
        create: {
          eventId: event.id,
          title: event.title,
          country: event.country,
          eventDate: new Date(event.date),
          actual: String(event.actual ?? ''),
          forecast: event.forecast !== null && event.forecast !== undefined ? String(event.forecast) : null,
          previous: event.previous !== null && event.previous !== undefined ? String(event.previous) : null,
        },
      });
    } catch (err: any) {
      this.logger.error(`Lỗi lưu MacroAlertLog (id=${event.id}): ${err.message}`);
    }
  }

  /**
   * Format số liệu kèm đơn vị tính
   */
  private formatValue(val: number | string | null | undefined, unit: string): string {
    if (val === null || val === undefined || val === '') return 'N/A';
    const num = Number(val);
    if (!isNaN(num)) {
      return `${num}${unit ? ' ' + unit : ''}`.trim();
    }
    return `${val}${unit ? ' ' + unit : ''}`.trim();
  }

  /**
   * Phân tích và đánh giá tác động của số liệu Actual so với Forecast
   */
  analyzeEvent(event: EconomicEvent): MacroAnalysisResult {
    const unit = event.unit || '';
    const flag = this.getCountryFlag(event.country);

    const actualStr = this.formatValue(event.actual, unit);
    const forecastStr = this.formatValue(event.forecast, unit);
    const previousStr = this.formatValue(event.previous, unit);

    const eventDate = new Date(event.date);
    // Chuyển sang giờ Việt Nam (UTC+7)
    const vnTime = new Date(eventDate.getTime() + 7 * 3600 * 1000);
    const dateStr = vnTime.toISOString().slice(0, 10).split('-').reverse().join('/');
    const timeStr = vnTime.toISOString().slice(11, 16);

    const impactLevel = this.getImpactLabel(event.importance);

    const actualNum = typeof event.actual === 'number' ? event.actual : parseFloat(String(event.actual));
    const forecastNum = typeof event.forecast === 'number' ? event.forecast : parseFloat(String(event.forecast));

    let differenceText = '';
    let assessment = '';

    const hasDiff = !isNaN(actualNum) && !isNaN(forecastNum);
    const diff = hasDiff ? actualNum - forecastNum : 0;
    const diffSign = diff > 0 ? `+${diff.toFixed(2)}` : diff.toFixed(2);

    if (hasDiff) {
      differenceText = `${diffSign}${unit}`;
    }

    const titleLower = (event.title || '').toLowerCase();

    // 1. Phân tích nhóm Lạm phát (CPI / PPI / PCE)
    if (titleLower.includes('cpi') || titleLower.includes('ppi') || titleLower.includes('pce')) {
      if (!hasDiff) {
        assessment = '📊 Số liệu lạm phát vừa công bố, cần theo dõi thêm phản ứng dòng tiền thị trường.';
      } else if (diff < -0.001) {
        assessment = `🟢 <b>TÍCH CỰC CHO CHỨNG KHOÁN & THỊ TRƯỜNG:</b>\nLạm phát thực tế (${actualStr}) hạ nhiệt nhanh hơn kỳ vọng (${forecastStr}) với mức giảm ${differenceText}. Giảm áp lực điều hành lãi suất từ Fed/Ngân hàng Trung ương, hỗ trợ tâm lý tích cực cho dòng tiền đầu tư!`;
      } else if (diff > 0.001) {
        assessment = `🔴 <b>ÁP LỰC CHO THỊ TRƯỜNG:</b>\nLạm phát thực tế (${actualStr}) cao hơn dự báo (${forecastStr}) chênh lệch ${differenceText}. Tín hiệu lạm phát còn dai dẳng, gia tăng áp lực giữ lãi suất cao lâu hơn hoặc trì hoãn nới lỏng tiền tệ!`;
      } else {
        assessment = `⚪ <b>ĐÚNG KỲ VỌNG:</b>\nSố liệu lạm phát (${actualStr}) khớp chính xác với dự báo (${forecastStr}). Thị trường phần lớn đã phản ánh kịch bản này vào giá.`;
      }
    }
    // 2. Phân tích nhóm Việc làm Mỹ (NFP - Non-Farm Payrolls, ADP)
    else if (titleLower.includes('payrolls') || titleLower.includes('nfp')) {
      if (!hasDiff) {
        assessment = '📊 Báo cáo việc làm phi nông nghiệp vừa công bố.';
      } else if (diff > 0.001) {
        assessment = `🟢 <b>VIỆC LÀM TĂNG MẠNH:</b>\nSố lượng việc làm mới (${actualStr}) vượt dự báo (${forecastStr}) thêm ${differenceText}. Kinh tế tiếp tục vững vàng, tạo nền tảng thu nhập tốt nhưng có thể khiến Fed thận trọng hơn trong việc nới lỏng lãi suất.`;
      } else if (diff < -0.001) {
        assessment = `🔴 <b>VIỆC LÀM HẠ NHIỆT:</b>\nSố lượng việc làm mới (${actualStr}) thấp hơn dự báo (${forecastStr}) ${differenceText}. Thị trường lao động có dấu hiệu suy yếu, củng cố kỳ vọng cắt giảm lãi suất sớm hơn!`;
      } else {
        assessment = `⚪ <b>KHỚP DỰ BÁO:</b>\nSố liệu việc làm (${actualStr}) tương đương mức dự báo (${forecastStr}).`;
      }
    }
    // 3. Phân tích Thất nghiệp (Unemployment Rate, Jobless Claims)
    else if (titleLower.includes('unemployment') || titleLower.includes('jobless')) {
      if (!hasDiff) {
        assessment = '📊 Dữ liệu thất nghiệp vừa công bố.';
      } else if (diff > 0.001) {
        assessment = `⚠️ <b>TỶ LỆ THẤT NGHIỆP TĂNG:</b>\nSố liệu thực tế (${actualStr}) cao hơn dự báo (${forecastStr}) ${differenceText}. Áp lực suy yếu thị trường lao động gia tăng, thúc đẩy Fed nới lỏng tiền tệ.`;
      } else if (diff < -0.001) {
        assessment = `🟢 <b>THẤT NGHIỆP THẤP:</b>\nSố liệu thực tế (${actualStr}) thấp hơn dự báo (${forecastStr}) ${differenceText}. Thị trường lao động vẫn duy trì sự thắt chặt ổn định.`;
      } else {
        assessment = `⚪ <b>ĐÚNG DỰ BÁO:</b>\nSố liệu (${actualStr}) khớp kỳ vọng (${forecastStr}).`;
      }
    }
    // 4. Phân tích Quyết định Lãi suất (Interest Rate / Fed Funds / FOMC)
    else if (titleLower.includes('interest rate') || titleLower.includes('fed funds') || titleLower.includes('fomc')) {
      if (!hasDiff) {
        assessment = `🏛️ <b>QUYẾT ĐỊNH LÃI SUẤT:</b> Lãi suất công bố ở mức ${actualStr}.`;
      } else if (diff < -0.001) {
        assessment = `🚀 <b>NỚI LỎNG LÃI SUẤT:</b>\nLãi suất thực tế (${actualStr}) thấp hơn kỳ vọng (${forecastStr}) ${differenceText}. Đây là động lực kích thích dòng vốn tài sản rủi ro (chứng khoán, crypto, hàng hóa)!`;
      } else if (diff > 0.001) {
        assessment = `⚠️ <b>LÃI SUẤT CAO HƠN KỲ VỌNG:</b>\nLãi suất công bố (${actualStr}) cao hơn dự kiến (${forecastStr}) ${differenceText}. Áp lực thắt chặt tiền tệ.`;
      } else {
        assessment = `⚪ <b>LÃI SUẤT THEO ĐÚNG DỰ TÍNH:</b>\nLãi suất công bố (${actualStr}) khớp 100% với kỳ vọng trước đó của giới đầu tư.`;
      }
    }
    // 5. Mặc định (GDP, Doanh số bán lẻ, PMI...)
    else {
      if (hasDiff && diff > 0.001) {
        assessment = `🟢 <b>VƯỢT DỰ BÁO (${differenceText}):</b> Số liệu thực tế tốt hơn kỳ vọng của các chuyên gia.`;
      } else if (hasDiff && diff < -0.001) {
        assessment = `🔴 <b>THẤP HƠN DỰ BÁO (${differenceText}):</b> Số liệu thực tế thấp hơn kỳ vọng của các chuyên gia.`;
      } else if (hasDiff) {
        assessment = `⚪ <b>KHỚP DỰ BÁO:</b> Số liệu thực tế đúng như kỳ vọng của thị trường.`;
      } else {
        assessment = `📊 Số liệu vừa được cập nhật chính thức.`;
      }
    }

    return {
      title: event.title,
      country: event.country,
      countryFlag: flag,
      actualStr,
      forecastStr,
      previousStr,
      dateStr,
      timeStr,
      impactLevel,
      differenceText,
      assessment,
    };
  }

  /**
   * Tạo tin nhắn thông báo Telegram định dạng HTML
   */
  formatTelegramMessage(analysis: MacroAnalysisResult): string {
    return `
🚨 <b>BÁO ĐỘNG VĨ MÔ TỨC THÌ: ${analysis.countryFlag} ${analysis.title}</b>

🎯 <b>DỮ LIỆU VỪA CÔNG BỐ (ACTUAL):</b>
• 🟢 <b>Thực tế (Actual):</b> <code>${analysis.actualStr}</code>
• 📋 <b>Dự báo (Forecast):</b> <code>${analysis.forecastStr}</code>
• ⏪ <b>Kỳ trước (Previous):</b> <code>${analysis.previousStr}</code>
${analysis.differenceText ? `• 🔍 <b>Chênh lệch:</b> <code>${analysis.differenceText}</code>\n` : ''}
💡 <b>NHẬN ĐỊNH TÁC ĐỘNG:</b>
${analysis.assessment}

⏰ <b>Giờ ra tin:</b> ${analysis.timeStr} (VN) | ${analysis.dateStr}
🏷 <b>Mức độ ảnh hưởng:</b> ${analysis.impactLevel}
    `.trim();
  }

  /**
   * Tổng hợp lịch sự kiện kinh tế quan trọng trong ngày hôm nay (dùng cho lệnh /calendar hoặc /macro)
   */
  async getTodayScheduleText(userLevels?: number[]): Promise<string> {
    const events = await this.fetchEvents();
    const keyEvents = this.filterKeyEvents(events, userLevels);

    const now = new Date();
    const todayStr = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

    // Lọc các sự kiện trong ngày hôm nay theo giờ VN
    const todayEvents = keyEvents.filter((e) => {
      const vnDate = new Date(new Date(e.date).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      return vnDate === todayStr;
    });

    if (todayEvents.length === 0) {
      return `📅 <b>LỊCH KINH TẾ VĨ MÔ HÔM NAY (${todayStr.split('-').reverse().join('/')})</b>\n\nKhông có tin tức kinh tế vĩ mô phù hợp với bộ lọc được lên lịch công bố trong ngày hôm nay.`;
    }

    // Sắp xếp theo thứ tự thời gian
    todayEvents.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let message = `📅 <b>LỊCH KINH TẾ VĨ MÔ QUAN TRỌNG HÔM NAY (${todayStr.split('-').reverse().join('/')})</b>\n`;
    if (userLevels && userLevels.length > 0) {
      const filterTags = userLevels
        .map((lvl) => {
          if (lvl === 1) return '⭐⭐⭐ Cao';
          if (lvl === -1) return '⭐ Thấp';
          return '⭐⭐ Trung bình';
        })
        .join(', ');
      message += `🎯 <i>Bộ lọc hiện tại của bạn: ${filterTags}</i>\n`;
    }
    message += `<i>👉 Bot sẽ tự động bắn thông báo ngay lập tức khi số liệu Actual vừa được công bố!</i>\n\n`;

    for (const e of todayEvents) {
      const flag = this.getCountryFlag(e.country);
      const vnTime = new Date(new Date(e.date).getTime() + 7 * 3600 * 1000).toISOString().slice(11, 16);
      const unit = e.unit || '';
      const stars = e.importance === 1 ? '⭐⭐⭐' : e.importance === -1 ? '⭐' : '⭐⭐';

      const hasActual = e.actual !== null && e.actual !== undefined && e.actual !== '';
      const actualStr = hasActual ? `<b>${e.actual}${unit}</b> ✅` : '<i>Chờ ra tin</i> ⏳';
      const forecastStr = e.forecast !== null && e.forecast !== undefined ? `${e.forecast}${unit}` : 'N/A';
      const prevStr = e.previous !== null && e.previous !== undefined ? `${e.previous}${unit}` : 'N/A';

      message += `⏰ <b>${vnTime}</b> | ${stars} ${flag} <b>${e.title}</b>\n`;
      message += `   • Thực tế (Actual): ${actualStr}\n`;
      message += `   • Dự báo (Forecast): <code>${forecastStr}</code> | Kỳ trước: <code>${prevStr}</code>\n\n`;
    }

    return message.trim();
  }
}
