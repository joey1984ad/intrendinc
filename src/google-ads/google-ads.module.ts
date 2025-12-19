import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { GoogleAdsController } from './google-ads.controller';
import { GoogleAdsService } from './google-ads.service';
import { GoogleAdsSession } from './entities/google-ads-session.entity';
import { GoogleAdsMetricsCache } from './entities/google-ads-metrics-cache.entity';
import { GoogleAdsCampaignData } from './entities/google-ads-campaign-data.entity';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import googleAdsConfig from '../config/google-ads.config';

@Module({
  imports: [
    ConfigModule.forFeature(googleAdsConfig),
    TypeOrmModule.forFeature([
      GoogleAdsSession,
      GoogleAdsMetricsCache,
      GoogleAdsCampaignData,
    ]),
    forwardRef(() => SubscriptionsModule),
  ],
  controllers: [GoogleAdsController],
  providers: [GoogleAdsService],
  exports: [GoogleAdsService],
})
export class GoogleAdsModule {}
