import { Module } from '@nestjs/common';
import { StockService } from './stock.service';

@Module({
  providers: [StockService],
  exports: [StockService],
})
export class StockModule {}
