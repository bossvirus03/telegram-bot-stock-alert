import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.connectWithRetry();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Thử kết nối lại Database nếu bị ngắt kết nối (Re-connect handler)
   */
  async connectWithRetry(retries = 3, delayMs = 2000) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.$connect();
        return;
      } catch (error) {
        this.logger.warn(`Thử kết nối lại PostgreSQL (NeonDB) thất bại (Lần ${i + 1}/${retries}): ${error.message}`);
        if (i === retries - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Chạy hàm query với cơ chế tự động reconnect nếu kết nối NeonDB bị sập tạm thời
   */
  async executeWithRetry<T>(queryFn: () => Promise<T>, maxRetries = 2): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await queryFn();
      } catch (error: any) {
        const isClosedError =
          error?.message?.includes('Server has closed the connection') ||
          error?.message?.includes('Kind: Closed') ||
          error?.code === 'P1001' ||
          error?.code === 'P1017';

        if (isClosedError && attempt < maxRetries) {
          this.logger.warn(`[Prisma] Kết nối NeonDB bị ngắt. Đang tự động kết nối lại (Lần ${attempt}/${maxRetries})...`);
          try {
            await this.$disconnect();
          } catch (e) {}
          await this.connectWithRetry(2, 1000);
        } else {
          throw error;
        }
      }
    }
    throw new Error('Không thể thực thi câu lệnh SQL sau khi thử lại.');
  }
}
