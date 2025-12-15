import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacebookService } from './facebook.service';
import { FacebookController } from './facebook.controller';
import { AdsLibraryController } from './controllers/ads-library.controller';
import { AdsLibraryEmbedController } from './controllers/ads-library-embed.controller';
import { FacebookSession } from './entities/facebook-session.entity';
import { CampaignData } from './entities/campaign-data.entity';
import { MetricsCache } from './entities/metrics-cache.entity';
import { CreativesCache } from './entities/creatives-cache.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FacebookSession,
      CampaignData,
      MetricsCache,
      CreativesCache,
    ]),
    ConfigModule,
  ],
  controllers: [FacebookController, AdsLibraryController, AdsLibraryEmbedController],
  providers: [FacebookService],
  exports: [FacebookService],
})
export class FacebookModule {}

