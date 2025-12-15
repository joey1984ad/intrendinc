import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { TikTokService } from './tiktok.service';
import { TikTokController } from './tiktok.controller';
import { TikTokAiController } from './tiktok-ai.controller';
import { TikTokSession } from './entities/tiktok-session.entity';
import { TikTokMetricsCache } from './entities/tiktok-metrics-cache.entity';
import { TikTokCreativesCache } from './entities/tiktok-creatives-cache.entity';
import { TikTokCampaignData } from './entities/tiktok-campaign-data.entity';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TikTokSession,
      TikTokMetricsCache,
      TikTokCreativesCache,
      TikTokCampaignData,
    ]),
    ConfigModule,
    AiModule,
  ],
  controllers: [TikTokController, TikTokAiController],
  providers: [TikTokService],
  exports: [TikTokService],
})
export class TikTokModule {}
