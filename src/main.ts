import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('StockNewsBot');
  const app = await NestFactory.create(AppModule);

  let port = Number(process.env.PORT) || 3001;
  const maxRetries = 5;

  for (let i = 0; i < maxRetries; i++) {
    try {
      await app.listen(port);
      logger.log(`🚀 Stock News & Realtime Flow Bot Backend đã khởi động thành công trên cổng ${port}`);
      break;
    } catch (err: any) {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`Cổng ${port} đã bị chiếm dụng, đang chuyển sang thử cổng ${port + 1}...`);
        port++;
      } else {
        throw err;
      }
    }
  }
}

bootstrap();
