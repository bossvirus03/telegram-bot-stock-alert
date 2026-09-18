import { Injectable, Logger } from "@nestjs/common";
import { TelegramUser } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class WatchlistService {
  private readonly logger = new Logger(WatchlistService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Đăng ký thông tin User khi có người tương tác với Telegram Bot
   */
  async registerUser(chatId: string, username?: string) {
    try {
      await this.prisma.executeWithRetry(() =>
        this.prisma.telegramUser.upsert({
          where: { chatId },
          update: { username: username || undefined },
          create: { chatId, username: username || undefined },
        }),
      );
    } catch (e) {
      this.logger.error(`Không thể lưu user ${chatId}: ${e.message}`);
    }
  }

  /**
   * Lấy danh sách tất cả Telegram Chat ID từng tương tác với Bot
   */
  async getAllUsers(): Promise<TelegramUser[]> {
    return this.prisma.executeWithRetry(() =>
      this.prisma.telegramUser.findMany(),
    );
  }

  /**
   * Lấy cấu hình các mức độ cảnh báo vĩ mô của User (Mặc định: [1, 0] = Cao và Trung bình)
   */
  async getUserMacroAlertLevels(chatId: string): Promise<number[]> {
    try {
      const user = await this.prisma.executeWithRetry(() =>
        this.prisma.telegramUser.findUnique({
          where: { chatId },
          select: { macroAlertLevels: true },
        }),
      );
      if (user && Array.isArray(user.macroAlertLevels) && user.macroAlertLevels.length > 0) {
        return user.macroAlertLevels;
      }
      return [1, 0];
    } catch (e: any) {
      this.logger.error(`Lỗi đọc macroAlertLevels của user ${chatId}: ${e.message}`);
      return [1, 0];
    }
  }

  /**
   * Cập nhật danh sách mức độ cảnh báo vĩ mô của User
   */
  async updateUserMacroAlertLevels(chatId: string, levels: number[]): Promise<number[]> {
    const validLevels = Array.from(new Set(levels.filter((lvl) => [-1, 0, 1].includes(lvl)))).sort(
      (a, b) => b - a,
    );

    await this.prisma.executeWithRetry(() =>
      this.prisma.telegramUser.upsert({
        where: { chatId },
        update: { macroAlertLevels: validLevels },
        create: { chatId, macroAlertLevels: validLevels },
      }),
    );

    return validLevels;
  }

  /**
   * Bật/Tắt (Toggle) một mức độ cảnh báo vĩ mô cụ thể (-1, 0, 1)
   */
  async toggleUserMacroAlertLevel(chatId: string, level: number): Promise<number[]> {
    const current = await this.getUserMacroAlertLevels(chatId);
    let next: number[];

    if (current.includes(level)) {
      next = current.filter((l) => l !== level);
    } else {
      next = [...current, level];
    }

    return this.updateUserMacroAlertLevels(chatId, next);
  }

  /**
   * Thêm mã cổ phiếu vào danh mục theo dõi
   */
  async addSymbol(
    chatId: string,
    username: string | undefined,
    symbol: string,
  ) {
    const cleanSymbol = symbol.trim().toUpperCase();

    // Tự động lưu thông tin user
    await this.registerUser(chatId, username);

    const existing = await this.prisma.executeWithRetry(() =>
      this.prisma.userWatchlist.findUnique({
        where: {
          chatId_symbol: {
            chatId,
            symbol: cleanSymbol,
          },
        },
      }),
    );

    if (existing) {
      return {
        success: false,
        message: `Mã <b>${cleanSymbol}</b> đã có trong danh mục theo dõi của bạn.`,
      };
    }

    await this.prisma.executeWithRetry(() =>
      this.prisma.userWatchlist.create({
        data: {
          chatId,
          username: username || "Unknown",
          symbol: cleanSymbol,
        },
      }),
    );

    return {
      success: true,
      message: `Đã thêm thành công mã <b>${cleanSymbol}</b> vào danh mục theo dõi!`,
    };
  }

  /**
   * Xóa mã cổ phiếu khỏi danh mục theo dõi
   */
  async removeSymbol(chatId: string, symbol: string) {
    const cleanSymbol = symbol.trim().toUpperCase();

    try {
      await this.prisma.executeWithRetry(() =>
        this.prisma.userWatchlist.delete({
          where: {
            chatId_symbol: {
              chatId,
              symbol: cleanSymbol,
            },
          },
        }),
      );

      return {
        success: true,
        message: `Đã xóa mã <b>${cleanSymbol}</b> khỏi danh mục theo dõi!`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Mã <b>${cleanSymbol}</b> không có trong danh mục của bạn.`,
      };
    }
  }

  /**
   * Lấy danh sách các mã cổ phiếu đang theo dõi của 1 user
   */
  async getUserWatchlist(chatId: string): Promise<string[]> {
    const items = await this.prisma.executeWithRetry(() =>
      this.prisma.userWatchlist.findMany({
        where: { chatId },
        select: { symbol: true },
        orderBy: { createdAt: "asc" },
      }),
    );
    return items.map((item) => item.symbol);
  }

  /**
   * Lấy danh sách tất cả các User kèm danh mục cổ phiếu của họ
   */
  async getAllUsersWatchlist() {
    const items = await this.prisma.executeWithRetry(() =>
      this.prisma.userWatchlist.findMany(),
    );
    const groupedMap = new Map<string, string[]>();

    for (const item of items) {
      const list = groupedMap.get(item.chatId) || [];
      list.push(item.symbol);
      groupedMap.set(item.chatId, list);
    }

    return Array.from(groupedMap.entries()).map(([chatId, symbols]) => ({
      chatId,
      symbols,
    }));
  }
}
