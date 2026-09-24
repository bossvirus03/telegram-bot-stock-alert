import { Module } from '@nestjs/common';
import { GoldService } from './gold.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [GoldService],
  exports: [GoldService],
})
export class GoldModule {}
