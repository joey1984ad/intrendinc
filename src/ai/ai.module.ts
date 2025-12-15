import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AnalyzeCreativesController } from './analyze-creatives.controller';
import { GenerateVariationsController } from './generate-variations.controller';
import { GeminiService } from './services/gemini.service';
import { AiCreativeScore } from './entities/ai-creative-score.entity';
import { AiGeneratedCreative } from './entities/ai-generated-creative.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiCreativeScore,
      AiGeneratedCreative,
    ]),
    ConfigModule,
  ],
  controllers: [AiController, AnalyzeCreativesController, GenerateVariationsController],
  providers: [AiService, GeminiService],
  exports: [AiService, GeminiService],
})
export class AiModule {}


