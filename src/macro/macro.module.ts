import { Module } from '@nestjs/common';
import { MacroService } from './macro.service';

@Module({
  providers: [MacroService],
  exports: [MacroService],
})
export class MacroModule {}
