import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BigQueryService } from './bigquery.service';
import { GoogleAdsSyncService } from './google-ads-sync.service';
import { BigQuerySyncStatus } from './entities/sync-status.entity';
import { GoogleAdsSession } from '../google-ads/entities/google-ads-session.entity';
import bigqueryConfig from '../config/bigquery.config';

@Module({
  imports: [
    ConfigModule.forFeature(bigqueryConfig),
    TypeOrmModule.forFeature([
      BigQuerySyncStatus,
      GoogleAdsSession,
    ]),
  ],
  providers: [BigQueryService, GoogleAdsSyncService],
  exports: [BigQueryService, GoogleAdsSyncService],
})
export class BigQueryModule {}
