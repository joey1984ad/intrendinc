import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BigQueryService } from './bigquery.service';
import { BigQuerySyncStatus } from './entities/sync-status.entity';
import { GoogleAdsSession } from '../google-ads/entities/google-ads-session.entity';
import { GoogleAdsApi } from 'google-ads-api';

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
  private readonly client: GoogleAdsApi;
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
    this.client = new GoogleAdsApi({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      developer_token: this.developerToken,
    });
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
    const syncTargets = await this.resolveSyncCustomerTargets(freshSession, customerId);

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
        customerId: syncTargets.storageCustomerId,
        startDate: since,
        endDate: until,
      });
    }

    for (const queryCustomerId of syncTargets.queryCustomerIds) {
      this.logger.log(
        `Syncing source customer ${queryCustomerId} into storage customer ${syncTargets.storageCustomerId}`,
      );

      // 1. Sync daily account metrics
      const dailyMetricsRows = await this.fetchDailyAccountMetrics(
        freshSession,
        queryCustomerId,
        syncTargets.storageCustomerId,
        since,
        until,
        syncTargets.scopeResourceIds,
        syncTargets.loginCustomerIdOverride,
      );
      if (dailyMetricsRows.length > 0) {
        await this.bigQueryService.insertRows('daily_account_metrics', dailyMetricsRows);
        totalRows += dailyMetricsRows.length;
        this.logger.debug(`Inserted ${dailyMetricsRows.length} daily_account_metrics rows`);
      }

      // 2. Sync campaigns by date
      const campaignRows = await this.fetchCampaignsByDate(
        freshSession,
        queryCustomerId,
        syncTargets.storageCustomerId,
        since,
        until,
        syncTargets.scopeResourceIds,
        syncTargets.loginCustomerIdOverride,
      );
      if (campaignRows.length > 0) {
        await this.bigQueryService.insertRows('campaigns', campaignRows);
        totalRows += campaignRows.length;
        this.logger.debug(`Inserted ${campaignRows.length} campaigns rows`);
      }

      // 3. Sync ad groups by date
      const adGroupRows = await this.fetchAdGroupsByDate(
        freshSession,
        queryCustomerId,
        syncTargets.storageCustomerId,
        since,
        until,
        syncTargets.scopeResourceIds,
        syncTargets.loginCustomerIdOverride,
      );
      if (adGroupRows.length > 0) {
        await this.bigQueryService.insertRows('ad_groups', adGroupRows);
        totalRows += adGroupRows.length;
        this.logger.debug(`Inserted ${adGroupRows.length} ad_groups rows`);
      }

      // 4. Sync ads by date
      const adRows = await this.fetchAdsByDate(
        freshSession,
        queryCustomerId,
        syncTargets.storageCustomerId,
        since,
        until,
        syncTargets.scopeResourceIds,
        syncTargets.loginCustomerIdOverride,
      );
      if (adRows.length > 0) {
        await this.bigQueryService.insertRows('ads', adRows);
        totalRows += adRows.length;
        this.logger.debug(`Inserted ${adRows.length} ads rows`);
      }
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
    queryCustomerId: string,
    storageCustomerId: string,
    since: string,
    until: string,
    _scopeResourceIds: boolean,
    loginCustomerIdOverride: string,
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

    const response = await this.makeSearchRequest(session, queryCustomerId, query, loginCustomerIdOverride);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: storageCustomerId,
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
    queryCustomerId: string,
    storageCustomerId: string,
    since: string,
    until: string,
    scopeResourceIds: boolean,
    loginCustomerIdOverride: string,
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

    const response = await this.makeSearchRequest(session, queryCustomerId, query, loginCustomerIdOverride);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: storageCustomerId,
      date: result.segments?.date,
      campaign_id: this.scopeResourceId(scopeResourceIds ? queryCustomerId : '', result.campaign?.id),
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
    queryCustomerId: string,
    storageCustomerId: string,
    since: string,
    until: string,
    scopeResourceIds: boolean,
    loginCustomerIdOverride: string,
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

    const response = await this.makeSearchRequest(session, queryCustomerId, query, loginCustomerIdOverride);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: storageCustomerId,
      date: result.segments?.date,
      campaign_id: this.scopeResourceId(scopeResourceIds ? queryCustomerId : '', result.campaign?.id),
      ad_group_id: this.scopeResourceId(scopeResourceIds ? queryCustomerId : '', result.adGroup?.id),
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
    queryCustomerId: string,
    storageCustomerId: string,
    since: string,
    until: string,
    scopeResourceIds: boolean,
    loginCustomerIdOverride: string,
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

    const response = await this.makeSearchRequest(session, queryCustomerId, query, loginCustomerIdOverride);
    const now = new Date().toISOString();

    return (response.results || []).map((result: any) => ({
      user_id: session.userId,
      customer_id: storageCustomerId,
      date: result.segments?.date,
      campaign_id: this.scopeResourceId(scopeResourceIds ? queryCustomerId : '', result.campaign?.id),
      ad_group_id: this.scopeResourceId(scopeResourceIds ? queryCustomerId : '', result.adGroup?.id),
      ad_id: this.scopeResourceId(scopeResourceIds ? queryCustomerId : '', result.adGroupAd?.ad?.id),
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
    loginCustomerIdOverride?: string,
  ): Promise<{ results?: any[] }> {
    const cleanCustomerId = this.normalizeCustomerId(customerId);

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${session.accessToken}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    };

    const effectiveLoginCustomerId = this.normalizeCustomerId(
      loginCustomerIdOverride || this.getEffectiveLoginCustomerId(session),
    );
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
    let sawServerError = false;

    for (const version of versions) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const url = `${GOOGLE_ADS_API_BASE}/${version}/customers/${cleanCustomerId}/googleAds:search`;
        this.logger.log(`[SYNC API] ${version} POST ${url} attempt=${attempt}`);

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
        const detailsErrors = (errorData.error?.details || [])
          .flatMap((detail: any) => detail?.errors || [])
          .map((inner: any) => ({
            code: Object.keys(inner?.errorCode || {})[0] || 'UNKNOWN',
            value: Object.values(inner?.errorCode || {})[0] || '',
            message: inner?.message || '',
          }));
        const hasManagerMetricsError = detailsErrors.some(
          (inner: any) => inner.value === 'REQUESTED_METRICS_FOR_MANAGER',
        );

        this.logger.error(`[SYNC API] ${version} FAILED ${response.status} ${response.statusText}`);
        this.logger.error(`[SYNC API] Response body: ${rawText.slice(0, 1000)}`);

        const isVersionIssue =
          response.status === 404
          || response.status === 410
          || /not found/i.test(rawText)
          || /deprecated|sunset|unsupported/i.test(message);
        const isRetryable =
          response.status === 429
          || response.status === 500
          || response.status === 503
          || /internal error encountered/i.test(message)
          || /temporarily unavailable/i.test(message);

        if (response.status >= 500) {
          sawServerError = true;
        }

        lastError = new Error(`Google Ads API error ${response.status}: ${message}`);

        if (hasManagerMetricsError) {
          throw new Error(
            `Selected account ${cleanCustomerId} is a manager (MCC) account. ` +
            'Google Ads does not return metrics for manager accounts. Please select a client account.',
          );
        }

        if (isRetryable && attempt < 3) {
          await this.sleep(300 * attempt);
          continue;
        }

        if (isVersionIssue) {
          break;
        }

        if (!isRetryable) {
          throw lastError;
        }
      }
    }

    if (sawServerError) {
      this.logger.warn('[SYNC API] Falling back to google-ads-api client query after REST failures');
      return this.makeSearchRequestViaClient(session, cleanCustomerId, query, effectiveLoginCustomerId);
    }

    throw lastError || new Error('Google Ads API query failed');
  }

  private async makeSearchRequestViaClient(
    session: GoogleAdsSession,
    customerId: string,
    query: string,
    loginCustomerId: string,
  ): Promise<{ results?: any[] }> {
    if (!session.refreshToken) {
      throw new Error('No refresh token available for google-ads-api fallback');
    }

    const customerClient = this.client.Customer({
      customer_id: customerId,
      refresh_token: session.refreshToken,
      ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
    });

    const rows = await customerClient.query(query);
    return { results: rows.map((row) => this.toCamelCaseDeep(row)) };
  }

  private async resolveSyncCustomerTargets(
    session: GoogleAdsSession,
    selectedCustomerId: string,
  ): Promise<{
    storageCustomerId: string;
    queryCustomerIds: string[];
    scopeResourceIds: boolean;
    loginCustomerIdOverride: string;
  }> {
    if (!session.refreshToken) {
      throw new Error('No refresh token available for manager-account validation');
    }

    const loginCustomerId = this.getEffectiveLoginCustomerId(session);
    const customerClient = this.client.Customer({
      customer_id: selectedCustomerId,
      refresh_token: session.refreshToken,
      ...(loginCustomerId ? { login_customer_id: loginCustomerId } : {}),
    });

    const rows = await customerClient.query(`
      SELECT
        customer.id,
        customer.descriptive_name,
        customer.manager
      FROM customer
      LIMIT 1
    `);

    const selected = rows?.[0]?.customer;
    const isManager = !!selected?.manager;

    if (!isManager) {
      return {
        storageCustomerId: selectedCustomerId,
        queryCustomerIds: [selectedCustomerId],
        scopeResourceIds: false,
        loginCustomerIdOverride: loginCustomerId,
      };
    }

    const childRows = await customerClient.query(`
      SELECT
        customer_client.id,
        customer_client.descriptive_name,
        customer_client.manager,
        customer_client.hidden
      FROM customer_client
      WHERE customer_client.manager = FALSE
        AND customer_client.hidden = FALSE
    `);

    const queryCustomerIds = childRows
      .map((row: any) => this.normalizeCustomerId(row?.customer_client?.id?.toString()))
      .filter((id: string) => !!id);

    if (queryCustomerIds.length === 0) {
      throw new Error(
        `Selected manager account ${selectedCustomerId} has no active client accounts available for sync.`,
      );
    }

    return {
      storageCustomerId: selectedCustomerId,
      queryCustomerIds,
      scopeResourceIds: true,
      loginCustomerIdOverride: selectedCustomerId,
    };
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

  private scopeResourceId(prefix: string, value: any): string {
    const raw = value?.toString?.() || '';
    if (!raw) return '';
    return prefix ? `${prefix}:${raw}` : raw;
  }

  private toCamelCaseDeep(value: any): any {
    if (Array.isArray(value)) {
      return value.map((item) => this.toCamelCaseDeep(item));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, any> = {};
      for (const [key, inner] of Object.entries(value)) {
        const camelKey = key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase());
        out[camelKey] = this.toCamelCaseDeep(inner);
      }
      return out;
    }
    return value;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
