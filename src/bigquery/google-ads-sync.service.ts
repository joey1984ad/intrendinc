import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BigQueryService } from './bigquery.service';
import { BigQuerySyncStatus } from './entities/sync-status.entity';
import { GoogleAdsSession } from '../google-ads/entities/google-ads-session.entity';

// Google Ads API constants (same as in google-ads.service.ts)
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const GOOGLE_OAUTH_BASE = 'https://oauth2.googleapis.com';

@Injectable()
export class GoogleAdsSyncService {
  private readonly logger = new Logger(GoogleAdsSyncService.name);
  private readonly syncEnabled: boolean;
  private readonly lookbackDays: number;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly developerToken: string;
  private readonly apiVersion: string;
  private readonly defaultLoginCustomerId: string;
  private isSyncing = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly bigQueryService: BigQueryService,
    @InjectRepository(GoogleAdsSession)
    private readonly sessionRepository: Repository<GoogleAdsSession>,
    @InjectRepository(BigQuerySyncStatus)
    private readonly syncStatusRepository: Repository<BigQuerySyncStatus>,
  ) {
    const bqConfig = this.configService.get('bigquery');
    this.syncEnabled = bqConfig?.syncEnabled ?? true;
    this.lookbackDays = bqConfig?.syncLookbackDays ?? 90;

    const googleAdsConfig = this.configService.get('googleAds');
    this.clientId = googleAdsConfig?.clientId || '';
    this.clientSecret = googleAdsConfig?.clientSecret || '';
    this.developerToken = googleAdsConfig?.developerToken || '';
    this.apiVersion = googleAdsConfig?.apiVersion || 'v19';
    this.defaultLoginCustomerId = this.normalizeCustomerId(googleAdsConfig?.loginCustomerId || '');
  }

  // ==================== SCHEDULED SYNC ====================

  /**
   * Cron job: runs every 6 hours to sync all connected Google Ads accounts
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledSync(): Promise<void> {
    if (!this.syncEnabled || !this.bigQueryService.isReady()) {
      return;
    }

    this.logger.log('Starting scheduled Google Ads → BigQuery sync');
    await this.syncAllAccounts();
  }

  // ==================== SYNC ALL ACCOUNTS ====================

  /**
   * Sync all connected Google Ads accounts to BigQuery
   */
  async syncAllAccounts(): Promise<{ synced: number; failed: number; skipped: number }> {
    if (this.isSyncing) {
      this.logger.warn('Sync already in progress, skipping');
      return { synced: 0, failed: 0, skipped: 0 };
    }

    if (!this.bigQueryService.isReady()) {
      this.logger.warn('BigQuery not ready, skipping sync');
      return { synced: 0, failed: 0, skipped: 0 };
    }

    this.isSyncing = true;
    let synced = 0;
    let failed = 0;
    let skipped = 0;

    try {
      // Get all sessions with refresh tokens and selected customers
      const sessions = await this.sessionRepository
        .createQueryBuilder('session')
        .where('session.refresh_token IS NOT NULL')
        .andWhere('session.customer_id IS NOT NULL')
        .getMany();

      this.logger.log(`Found ${sessions.length} accounts to sync`);

      for (const session of sessions) {
        try {
          await this.syncAccount(session);
          synced++;
        } catch (error: any) {
          this.logger.error(
            `Failed to sync account userId=${session.userId} customerId=${session.customerId}: ${error.message}`,
          );
          failed++;

          // Record error in sync status
          await this.updateSyncStatus(session.userId, session.customerId, {
            lastSyncStatus: 'error',
            errorMessage: error.message,
          });
        }
      }

      this.logger.log(`Sync complete: ${synced} synced, ${failed} failed, ${skipped} skipped`);
      return { synced, failed, skipped };
    } finally {
      this.isSyncing = false;
    }
  }

  // ==================== SYNC SINGLE ACCOUNT ====================

  /**
   * Sync a single user's Google Ads account to BigQuery
   */
  async syncAccount(session: GoogleAdsSession): Promise<{ rowsSynced: number }> {
    const startTime = Date.now();
    const userId = session.userId;
    const customerId = this.normalizeCustomerId(session.customerId);

    if (!customerId) {
      throw new Error('No valid customer ID selected');
    }

    if (session.customerId !== customerId) {
      session.customerId = customerId;
      await this.sessionRepository.save(session);
    }

    this.logger.log(`Starting sync for userId=${userId}, customerId=${customerId}`);

    // Update status to syncing
    await this.updateSyncStatus(userId, customerId, {
      lastSyncStatus: 'syncing',
      errorMessage: undefined,
    });

    // Ensure token is fresh
    const freshSession = await this.ensureFreshToken(session);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - this.lookbackDays);
    const since = startDate.toISOString().split('T')[0];
    const until = endDate.toISOString().split('T')[0];

    let totalRows = 0;

    // Delete existing data for this date range (upsert pattern)
    const tables = ['daily_account_metrics', 'campaigns', 'ad_groups', 'ads'];
    for (const table of tables) {
      await this.bigQueryService.deleteRows(table, {
        userId,
        customerId,
        startDate: since,
        endDate: until,
      });
    }

    // 1. Sync daily account metrics
    const dailyMetricsRows = await this.fetchDailyAccountMetrics(freshSession, since, until);
    if (dailyMetricsRows.length > 0) {
      await this.bigQueryService.insertRows('daily_account_metrics', dailyMetricsRows);
      totalRows += dailyMetricsRows.length;
      this.logger.debug(`Inserted ${dailyMetricsRows.length} daily_account_metrics rows`);
    }

    // 2. Sync campaigns by date
    const campaignRows = await this.fetchCampaignsByDate(freshSession, since, until);
    if (campaignRows.length > 0) {
      await this.bigQueryService.insertRows('campaigns', campaignRows);
      totalRows += campaignRows.length;
      this.logger.debug(`Inserted ${campaignRows.length} campaigns rows`);
    }

    // 3. Sync ad groups by date
    const adGroupRows = await this.fetchAdGroupsByDate(freshSession, since, until);
    if (adGroupRows.length > 0) {
      await this.bigQueryService.insertRows('ad_groups', adGroupRows);
      totalRows += adGroupRows.length;
      this.logger.debug(`Inserted ${adGroupRows.length} ad_groups rows`);
    }

    // 4. Sync ads by date
    const adRows = await this.fetchAdsByDate(freshSession, since, until);
    if (adRows.length > 0) {
      await this.bigQueryService.insertRows('ads', adRows);
      totalRows += adRows.length;
      this.logger.debug(`Inserted ${adRows.length} ads rows`);
    }

    const durationMs = Date.now() - startTime;

    // Update sync status
    await this.updateSyncStatus(userId, customerId, {
      lastSyncAt: new Date(),
      lastSyncStatus: 'success',
      rowsSynced: totalRows,
      syncDurationMs: durationMs,
      errorMessage: undefined,
    });

    this.logger.log(
      `Sync complete for userId=${userId}, customerId=${customerId}: ${totalRows} rows in ${durationMs}ms`,
    );

    return { rowsSynced: totalRows };
  }

  /**
   * Sync a single user's account by userId (for manual trigger from controller)
   */
  async syncByUserId(userId: number): Promise<{ rowsSynced: number }> {
    const session = await this.sessionRepository.findOne({
      where: { userId },
    });

    if (!session || !session.refreshToken || !session.customerId) {
      throw new Error('No valid Google Ads session with a selected customer');
    }

    return this.syncAccount(session);
  }

  // ==================== GET SYNC STATUS ====================

  /**
   * Get sync status for a user's account
   */
  async getSyncStatus(userId: number, customerId: string): Promise<BigQuerySyncStatus | null> {
    return this.syncStatusRepository.findOne({
      where: { userId, customerId },
    });
  }

  // ==================== GAQL FETCH METHODS (date-segmented) ====================

  /**
   * Fetch daily account-level metrics via GAQL
   */
  private async fetchDailyAccountMetrics(
    session: GoogleAdsSession,
    since: string,
    until: string,
  ): Promise<Record<string, any>[]> {
    const query = `
      SELECT 
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: session.customerId,
      date: result.segments?.date,
      impressions: parseInt(result.metrics?.impressions || '0', 10),
      clicks: parseInt(result.metrics?.clicks || '0', 10),
      cost_micros: parseInt(result.metrics?.costMicros || '0', 10),
      conversions: parseFloat(result.metrics?.conversions || '0'),
      conversions_value: parseFloat(result.metrics?.conversionsValue || '0'),
      synced_at: now,
    }));
  }

  /**
   * Fetch campaigns with date segmentation via GAQL
   */
  private async fetchCampaignsByDate(
    session: GoogleAdsSession,
    since: string,
    until: string,
  ): Promise<Record<string, any>[]> {
    const query = `
      SELECT 
        segments.date,
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.bidding_strategy_type,
        campaign_budget.amount_micros,
        campaign_budget.type,
        campaign.start_date,
        campaign.end_date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date, campaign.name
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: session.customerId,
      date: result.segments?.date,
      campaign_id: result.campaign?.id,
      name: result.campaign?.name,
      status: result.campaign?.status,
      channel_type: result.campaign?.advertisingChannelType,
      bidding_strategy: result.campaign?.biddingStrategyType,
      budget_micros: parseInt(result.campaignBudget?.amountMicros || '0', 10),
      budget_type: result.campaignBudget?.type,
      start_date: result.campaign?.startDate,
      end_date: result.campaign?.endDate,
      impressions: parseInt(result.metrics?.impressions || '0', 10),
      clicks: parseInt(result.metrics?.clicks || '0', 10),
      cost_micros: parseInt(result.metrics?.costMicros || '0', 10),
      conversions: parseFloat(result.metrics?.conversions || '0'),
      conversions_value: parseFloat(result.metrics?.conversionsValue || '0'),
      synced_at: now,
    }));
  }

  /**
   * Fetch ad groups with date segmentation via GAQL
   */
  private async fetchAdGroupsByDate(
    session: GoogleAdsSession,
    since: string,
    until: string,
  ): Promise<Record<string, any>[]> {
    const query = `
      SELECT 
        segments.date,
        ad_group.id,
        ad_group.name,
        ad_group.status,
        ad_group.type,
        campaign.id,
        ad_group.cpc_bid_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM ad_group
      WHERE segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date, ad_group.name
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: session.customerId,
      date: result.segments?.date,
      campaign_id: result.campaign?.id,
      ad_group_id: result.adGroup?.id,
      name: result.adGroup?.name,
      status: result.adGroup?.status,
      type: result.adGroup?.type,
      cpc_bid_micros: parseInt(result.adGroup?.cpcBidMicros || '0', 10),
      impressions: parseInt(result.metrics?.impressions || '0', 10),
      clicks: parseInt(result.metrics?.clicks || '0', 10),
      cost_micros: parseInt(result.metrics?.costMicros || '0', 10),
      conversions: parseFloat(result.metrics?.conversions || '0'),
      synced_at: now,
    }));
  }

  /**
   * Fetch ads with date segmentation via GAQL
   */
  private async fetchAdsByDate(
    session: GoogleAdsSession,
    since: string,
    until: string,
  ): Promise<Record<string, any>[]> {
    const query = `
      SELECT 
        segments.date,
        ad_group_ad.ad.id,
        ad_group_ad.ad.name,
        ad_group_ad.ad.type,
        ad_group_ad.status,
        ad_group.id,
        campaign.id,
        ad_group_ad.ad.final_urls,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM ad_group_ad
      WHERE segments.date BETWEEN '${since}' AND '${until}'
      ORDER BY segments.date, ad_group_ad.ad.name
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: session.customerId,
      date: result.segments?.date,
      campaign_id: result.campaign?.id,
      ad_group_id: result.adGroup?.id,
      ad_id: result.adGroupAd?.ad?.id,
      name: result.adGroupAd?.ad?.name || `Ad ${result.adGroupAd?.ad?.id}`,
      type: result.adGroupAd?.ad?.type,
      status: result.adGroupAd?.status,
      final_urls: result.adGroupAd?.ad?.finalUrls?.join(', ') || '',
      impressions: parseInt(result.metrics?.impressions || '0', 10),
      clicks: parseInt(result.metrics?.clicks || '0', 10),
      cost_micros: parseInt(result.metrics?.costMicros || '0', 10),
      conversions: parseFloat(result.metrics?.conversions || '0'),
      synced_at: now,
    }));
  }

  // ==================== GOOGLE ADS API HELPERS ====================

  /**
   * Ensure the session token is fresh. Refreshes if expired.
   */
  private async ensureFreshToken(session: GoogleAdsSession): Promise<GoogleAdsSession> {
    if (session.tokenExpiresAt && session.tokenExpiresAt > new Date()) {
      return session;
    }

    if (!session.refreshToken) {
      throw new Error('No refresh token available');
    }

    this.logger.debug(`Refreshing token for userId=${session.userId}`);

    const response = await fetch(`${GOOGLE_OAUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: session.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Token refresh failed: ${errorData.error_description || response.statusText}`);
    }

    const tokenData = await response.json();

    const tokenExpiresAt = new Date();
    tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + (tokenData.expires_in || 3600));

    session.accessToken = tokenData.access_token;
    session.tokenExpiresAt = tokenExpiresAt;
    await this.sessionRepository.save(session);

    return session;
  }

  /**
   * Make a Google Ads GAQL Search request
   */
  private async makeSearchRequest(
    session: GoogleAdsSession,
    customerId: string,
    query: string,
  ): Promise<{ results?: any[] }> {
    const cleanCustomerId = this.normalizeCustomerId(customerId);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${session.accessToken}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    };

    const effectiveLoginCustomerId = this.getEffectiveLoginCustomerId(session);
    if (effectiveLoginCustomerId) {
      headers['login-customer-id'] = effectiveLoginCustomerId;
    }

    this.logger.log(
      `[SYNC API] customerId=${cleanCustomerId} loginCustomerId=${effectiveLoginCustomerId || 'none'}`,
    );
    this.logger.log(
      `[SYNC API] hasAccessToken=${!!session.accessToken} developerToken=${this.developerToken ? 'set' : 'MISSING'}`,
    );

    const versions = this.getApiVersionsToTry();
    let lastError: Error | null = null;

    for (const version of versions) {
      const url = `${GOOGLE_ADS_API_BASE}/${version}/customers/${cleanCustomerId}/googleAds:search`;
      this.logger.log(`[SYNC API] ${version} POST ${url}`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ query }),
      });

      if (response.ok) {
        return response.json();
      }

      const rawText = await response.text().catch(() => '');
      let errorData: any = {};
      try { errorData = JSON.parse(rawText); } catch {}
      const message = errorData.error?.message || response.statusText;

      this.logger.error(`[SYNC API] ${version} FAILED ${response.status} ${response.statusText}`);
      this.logger.error(`[SYNC API] Response body: ${rawText.slice(0, 1000)}`);

      const isVersionIssue =
        response.status === 404
        || response.status === 410
        || /not found/i.test(rawText)
        || /deprecated|sunset|unsupported/i.test(message);

      lastError = new Error(`Google Ads API error ${response.status}: ${message}`);
      if (!isVersionIssue) {
        throw lastError;
      }
    }

    throw lastError || new Error('Google Ads API query failed');
  }

  private getApiVersionsToTry(): string[] {
    const preferred = this.apiVersion || 'v19';
    const fallbacks = ['v20', 'v19', 'v18', 'v17'];
    return [preferred, ...fallbacks.filter((version) => version !== preferred)];
  }

  private normalizeCustomerId(value: string | undefined | null): string {
    if (!value) return '';
    return value.toString().replace(/^customers\//i, '').replace(/-/g, '').trim();
  }

  private getEffectiveLoginCustomerId(session: GoogleAdsSession): string {
    return this.normalizeCustomerId(
      session.loginCustomerId || session.managerCustomerId || this.defaultLoginCustomerId,
    );
  }

  // ==================== SYNC STATUS HELPERS ====================

  /**
   * Create or update sync status record
   */
  private async updateSyncStatus(
    userId: number,
    customerId: string,
    updates: Partial<BigQuerySyncStatus>,
  ): Promise<void> {
    let status = await this.syncStatusRepository.findOne({
      where: { userId, customerId },
    });

    if (!status) {
      status = this.syncStatusRepository.create({
        userId,
        customerId,
        ...updates,
      });
    } else {
      Object.assign(status, updates);
    }

    await this.syncStatusRepository.save(status);
  }
}
