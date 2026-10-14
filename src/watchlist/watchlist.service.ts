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

}

