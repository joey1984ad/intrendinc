import { Injectable, Logger, UnauthorizedException, BadRequestException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GoogleAdsSession } from './entities/google-ads-session.entity';
import { GoogleAdsCampaignData } from './entities/google-ads-campaign-data.entity';
import { PlatformMetrics, PlatformCampaign, PlatformAdGroup, PlatformAd, AdPlatform } from '../common/interfaces/ad-platform.interface';
import { PlatformSubscriptionsService } from '../subscriptions/platform-subscriptions.service';
import { BigQueryService } from '../bigquery/bigquery.service';
import { GoogleAdsApi } from 'google-ads-api';

// Google Ads API base URL
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const GOOGLE_OAUTH_BASE = 'https://oauth2.googleapis.com';
const GOOGLE_ACCOUNTS_BASE = 'https://accounts.google.com';

interface GoogleAdsCustomer {
  resourceName: string;
  id: string;
  descriptiveName: string;
  currencyCode: string;
  timeZone: string;
  manager: boolean;
  testAccount: boolean;
}

interface GoogleAdsApiResponse<T> {
  results?: T[];
  nextPageToken?: string;
  totalResultsCount?: string;
}

@Injectable()
export class GoogleAdsService {
  private readonly logger = new Logger(GoogleAdsService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly developerToken: string;
  private readonly redirectUri: string;
  private readonly apiVersion: string;
  private readonly scopes: string[];
  private readonly client: GoogleAdsApi;
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(GoogleAdsSession)
    private readonly sessionRepository: Repository<GoogleAdsSession>,
    @InjectRepository(GoogleAdsCampaignData)
    private readonly campaignDataRepository: Repository<GoogleAdsCampaignData>,
    @Inject(forwardRef(() => PlatformSubscriptionsService))
    private readonly platformSubscriptionsService: PlatformSubscriptionsService,
    private readonly bigQueryService: BigQueryService,
  ) {
    const googleAdsConfig = this.configService.get('googleAds');
    this.clientId = googleAdsConfig?.clientId || '';
    this.clientSecret = googleAdsConfig?.clientSecret || '';
    this.developerToken = googleAdsConfig?.developerToken || '';
    this.redirectUri = googleAdsConfig?.redirectUri || 'http://localhost:3001/google-ads/auth/callback';
    this.apiVersion = googleAdsConfig?.apiVersion || 'v17';
    this.scopes = googleAdsConfig?.scopes || [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    this.client = new GoogleAdsApi({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      developer_token: this.developerToken,
    });
  }

  // ==================== SUBSCRIPTION VALIDATION ====================

  /**
   * Check if user has paid access to any Google Ads accounts
   * Uses the organization seats with platform='google'
   */
  async validateSubscription(userId: number): Promise<void> {
    const seats = await this.platformSubscriptionsService.getPlatformSeatsByUser(userId, AdPlatform.GOOGLE);

    if (seats.length === 0) {
      throw new ForbiddenException(
        'No active Google Ads subscriptions. Please subscribe to at least one Google Ads account.',
      );
    }
  }

  /**
   * Check if user can access a specific Google Ads customer account
   */
  async validateCustomerAccess(userId: number, customerId: string): Promise<void> {
    const seats = await this.platformSubscriptionsService.getPlatformSeatsByUser(userId, AdPlatform.GOOGLE);
    const hasAccess = seats.some(seat => seat.adAccountId === customerId);

    if (!hasAccess) {
      throw new ForbiddenException(
        'This Google Ads customer account is not included in your subscription. Please add it to your plan.',
      );
    }
  }

  /**
   * Get list of Google Ads accounts user has paid access to
   */
  async getPaidCustomerIds(userId: number): Promise<string[]> {
    const seats = await this.platformSubscriptionsService.getPlatformSeatsByUser(userId, AdPlatform.GOOGLE);
    return seats.map(seat => seat.adAccountId);
  }

  /**
   * Get subscription status for the user (Google Ads accounts)
   */
  async getSubscriptionStatus(userId: number): Promise<{
    hasSubscription: boolean;
    paidAccounts?: { id: string; name: string; addedAt: Date }[];
  }> {
    const seats = await this.platformSubscriptionsService.getPlatformSeatsByUser(userId, AdPlatform.GOOGLE);

    if (seats.length === 0) {
      return { hasSubscription: false };
    }

    return {
      hasSubscription: true,
      paidAccounts: seats.map(s => ({
        id: s.adAccountId,
        name: s.adAccountName,
        addedAt: s.addedAt,
      })),
    };
  }

  // ==================== AUTH ====================

  /**
   * Generate OAuth authorization URL
   */
  getAuthUrl(state?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: this.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      ...(state && { state }),
    });

    return `${GOOGLE_ACCOUNTS_BASE}/o/oauth2/v2/auth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleAuthCallback(
    userId: number,
    code: string,
  ): Promise<{ success: boolean; session?: GoogleAdsSession; error?: string }> {
    try {
      // Exchange code for tokens
      const tokenResponse = await fetch(`${GOOGLE_OAUTH_BASE}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: this.redirectUri,
        }).toString(),
      });

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json();
        this.logger.error('Token exchange failed:', errorData);
        return { success: false, error: errorData.error_description || 'Token exchange failed' };
      }

      const tokenData = await tokenResponse.json();

      // Calculate token expiry
      const tokenExpiresAt = new Date();
      tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + (tokenData.expires_in || 3600));

      // Find or create session
      let session = await this.sessionRepository.findOne({
        where: { userId },
      });

      if (session) {
        session.accessToken = tokenData.access_token;
        session.refreshToken = tokenData.refresh_token || session.refreshToken;
        session.tokenExpiresAt = tokenExpiresAt;
      } else {
        session = this.sessionRepository.create({
          userId,
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          tokenExpiresAt,
        });
      }

      await this.sessionRepository.save(session);

      this.logger.log(`Google Ads session created/updated for user ${userId}`);
      return { success: true, session };
    } catch (error: any) {
      this.logger.error('Auth callback error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(userId: number): Promise<{ success: boolean; expiresAt?: Date; error?: string }> {
    const session = await this.sessionRepository.findOne({ where: { userId } });

    if (!session || !session.refreshToken) {
      return { success: false, error: 'No refresh token available' };
    }

    try {
      const response = await fetch(`${GOOGLE_OAUTH_BASE}/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          refresh_token: session.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });

      if (!response.ok) {
        const errorData = await response.json();
        return { success: false, error: errorData.error_description || 'Token refresh failed' };
      }

      const tokenData = await response.json();

      const tokenExpiresAt = new Date();
      tokenExpiresAt.setSeconds(tokenExpiresAt.getSeconds() + (tokenData.expires_in || 3600));

      session.accessToken = tokenData.access_token;
      session.tokenExpiresAt = tokenExpiresAt;
      await this.sessionRepository.save(session);

      return { success: true, expiresAt: tokenExpiresAt };
    } catch (error: any) {
      this.logger.error('Token refresh error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current session for user
   */
  async getSession(userId: number): Promise<GoogleAdsSession | null> {
    const session = await this.sessionRepository.findOne({ where: { userId } });

    if (session && session.tokenExpiresAt && session.tokenExpiresAt < new Date()) {
      // Token expired, try to refresh
      const refreshResult = await this.refreshToken(userId);
      if (!refreshResult.success) {
        return null;
      }
      return this.sessionRepository.findOne({ where: { userId } });
    }

    return session;
  }

  /**
   * Delete session (disconnect)
   */
  async deleteSession(userId: number): Promise<{ success: boolean }> {
    await this.sessionRepository.delete({ userId });
    return { success: true };
  }

  // ==================== CUSTOMERS ====================

  /**
   * Get accessible customer accounts
   */
  async getAccessibleCustomers(userId: number): Promise<GoogleAdsCustomer[]> {
    const session = await this.getSession(userId);
    if (!session || !session.refreshToken) {
      throw new UnauthorizedException('No valid Google Ads session or refresh token');
    }

    try {
      const listResponse = await this.client.listAccessibleCustomers(session.refreshToken);

      if (!listResponse || !listResponse.resource_names || listResponse.resource_names.length === 0) {
        return [];
      }

      const customers: GoogleAdsCustomer[] = [];

      for (const resourceName of listResponse.resource_names) {
        const customerId = resourceName.replace('customers/', '');
        try {
          const customerDetails = await this.getCustomerDetails(session, customerId);
          if (customerDetails) {
            customers.push(customerDetails);
          }
        } catch (error) {
          this.logger.warn(`Could not get details for customer ${customerId}`);
        }
      }

      return customers;
    } catch (error: any) {
      this.logger.error('Error getting accessible customers:', error);
      throw error;
    }
  }

  /**
   * Get customer details by ID
   */
  private async getCustomerDetails(
    session: GoogleAdsSession,
    customerId: string,
  ): Promise<GoogleAdsCustomer | null> {
    const query = `
      SELECT 
        customer.id,
        customer.descriptive_name,
        customer.currency_code,
        customer.time_zone,
        customer.manager,
        customer.test_account
      FROM customer
      LIMIT 1
    `;

    try {
      const customerClient = this.client.Customer({
        customer_id: customerId.replace(/-/g, ''),
        refresh_token: session.refreshToken,
      });

      const response = await customerClient.query(query);
      const result = response[0];
      
      if (result?.customer) {
        return {
          resourceName: `customers/${customerId}`,
          id: result.customer.id?.toString() || '',
          descriptiveName: result.customer.descriptive_name || `Account ${customerId}`,
          currencyCode: result.customer.currency_code || '',
          timeZone: result.customer.time_zone || '',
          manager: result.customer.manager || false,
          testAccount: result.customer.test_account || false,
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Select a customer account
   */
  async selectCustomer(
    userId: number,
    customerId: string,
    customerName?: string,
  ): Promise<{ success: boolean }> {
    const session = await this.getSession(userId);
    if (!session) {
      throw new UnauthorizedException('No valid Google Ads session');
    }

    session.customerId = customerId;
    session.customerName = customerName || `Account ${customerId}`;
    await this.sessionRepository.save(session);

    return { success: true };
  }

  // ==================== CAMPAIGNS ====================

  /**
   * Get campaigns for the selected customer from BigQuery
   */
  async getCampaigns(
    userId: number,
    startDate?: string,
    endDate?: string,
  ): Promise<PlatformCampaign[]> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId) {
      throw new UnauthorizedException('No valid session or customer selected');
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }

    return this.getCampaignsFromBigQuery(userId, session.customerId, startDate, endDate);
  }

  /**
   * Read campaigns from BigQuery (aggregated across dates)
   * @internal
   */
  private async getCampaignsFromBigQuery(
    userId: number,
    customerId: string,
    startDate: string,
    endDate: string,
  ): Promise<PlatformCampaign[]> {
    const tableRef = this.bigQueryService.getTableRef('campaigns');
    const sql = `
      SELECT
        campaign_id,
        ANY_VALUE(name) as name,
        ANY_VALUE(status) as status,
        ANY_VALUE(channel_type) as channel_type,
        ANY_VALUE(budget_micros) as budget_micros,
        ANY_VALUE(budget_type) as budget_type,
        ANY_VALUE(start_date) as start_date,
        ANY_VALUE(end_date) as end_date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost_micros) as cost_micros,
        SUM(conversions) as conversions,
        SUM(conversions_value) as conversions_value
      FROM ${tableRef}
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
      GROUP BY campaign_id
      ORDER BY name
    `;

    const rows = await this.bigQueryService.query(sql, {
      userId,
      customerId,
      startDate,
      endDate,
    });

    return rows.map((row: any) => ({
      id: row.campaign_id,
      name: row.name,
      status: row.status,
      objective: row.channel_type,
      budget: row.budget_micros ? row.budget_micros / 1000000 : 0,
      budgetType: row.budget_type === 'DAILY' ? 'daily' as const : 'lifetime' as const,
      startTime: row.start_date ? new Date(row.start_date) : undefined,
      endTime: row.end_date ? new Date(row.end_date) : undefined,
      metrics: {
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        spend: (row.cost_micros || 0) / 1000000,
        conversions: row.conversions || 0,
        ctr: this.calculateCtr(row.clicks, row.impressions),
        cpc: this.calculateCpc(row.cost_micros, row.clicks),
        cpm: this.calculateCpm(row.cost_micros, row.impressions),
        roas: this.calculateRoas(row.conversions_value, row.cost_micros),
      },
    }));
  }

  /**
   * Get single campaign by ID
   */
  async getCampaign(userId: number, campaignId: string): Promise<PlatformCampaign | null> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId || !session.refreshToken) {
      throw new UnauthorizedException('No valid session or customer selected');
    }

    const query = `
      SELECT 
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE campaign.id = ${campaignId}
    `;

    const customerClient = this.client.Customer({
      customer_id: session.customerId.replace(/-/g, ''),
      refresh_token: session.refreshToken,
    });

    const response = await customerClient.query(query);
    const result = response[0];

    if (!result) return null;

    return {
      id: result.campaign?.id?.toString() || '',
      name: result.campaign?.name || '',
      status: result.campaign?.status?.toString() || '',
      objective: (result.campaign?.advertising_channel_type as unknown as string) || '',
      budget: result.campaign_budget?.amount_micros ? result.campaign_budget.amount_micros / 1000000 : 0,
      metrics: {
        impressions: parseInt(result.metrics?.impressions?.toString() || '0', 10),
        clicks: parseInt(result.metrics?.clicks?.toString() || '0', 10),
        spend: (result.metrics?.cost_micros || 0) / 1000000,
        conversions: parseFloat(result.metrics?.conversions?.toString() || '0'),
        ctr: this.calculateCtr(result.metrics?.clicks, result.metrics?.impressions),
        cpc: this.calculateCpc(result.metrics?.cost_micros, result.metrics?.clicks),
        cpm: this.calculateCpm(result.metrics?.cost_micros, result.metrics?.impressions),
      },
    };
  }

  // ==================== AD GROUPS ====================

  /**
   * Get ad groups from BigQuery
   */
  async getAdGroups(
    userId: number,
    campaignId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<PlatformAdGroup[]> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId) {
      throw new UnauthorizedException('No valid session or customer selected');
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }

    return this.getAdGroupsFromBigQuery(userId, session.customerId, campaignId, startDate, endDate);
  }

  /**
   * Read ad groups from BigQuery (aggregated across dates)
   */
  private async getAdGroupsFromBigQuery(
    userId: number,
    customerId: string,
    campaignId: string | undefined,
    startDate: string,
    endDate: string,
  ): Promise<PlatformAdGroup[]> {
    const tableRef = this.bigQueryService.getTableRef('ad_groups');
    let sql = `
      SELECT
        ad_group_id,
        ANY_VALUE(campaign_id) as campaign_id,
        ANY_VALUE(name) as name,
        ANY_VALUE(status) as status,
        ANY_VALUE(cpc_bid_micros) as cpc_bid_micros,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost_micros) as cost_micros,
        SUM(conversions) as conversions
      FROM ${tableRef}
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
    `;

    const params: Record<string, any> = { userId, customerId, startDate, endDate };

    if (campaignId) {
      sql += `  AND campaign_id = @campaignId\n`;
      params.campaignId = campaignId;
    }

    sql += `
      GROUP BY ad_group_id
      ORDER BY name
    `;

    const rows = await this.bigQueryService.query(sql, params);

    return rows.map((row: any) => ({
      id: row.ad_group_id,
      campaignId: row.campaign_id,
      name: row.name,
      status: row.status,
      bidAmount: row.cpc_bid_micros ? row.cpc_bid_micros / 1000000 : 0,
      metrics: {
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        spend: (row.cost_micros || 0) / 1000000,
        conversions: row.conversions || 0,
        ctr: this.calculateCtr(row.clicks, row.impressions),
        cpc: this.calculateCpc(row.cost_micros, row.clicks),
        cpm: this.calculateCpm(row.cost_micros, row.impressions),
      },
    }));
  }

  // ==================== ADS ====================

  /**
   * Get ads from BigQuery
   */
  async getAds(
    userId: number,
    adGroupId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<PlatformAd[]> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId) {
      throw new UnauthorizedException('No valid session or customer selected');
    }

    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }

    return this.getAdsFromBigQuery(userId, session.customerId, adGroupId, startDate, endDate);
  }

  /**
   * Read ads from BigQuery (aggregated across dates)
   */
  private async getAdsFromBigQuery(
    userId: number,
    customerId: string,
    adGroupId: string | undefined,
    startDate: string,
    endDate: string,
  ): Promise<PlatformAd[]> {
    const tableRef = this.bigQueryService.getTableRef('ads');
    let sql = `
      SELECT
        ad_id,
        ANY_VALUE(ad_group_id) as ad_group_id,
        ANY_VALUE(campaign_id) as campaign_id,
        ANY_VALUE(name) as name,
        ANY_VALUE(status) as status,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost_micros) as cost_micros,
        SUM(conversions) as conversions
      FROM ${tableRef}
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
    `;

    const params: Record<string, any> = { userId, customerId, startDate, endDate };

    if (adGroupId) {
      sql += `  AND ad_group_id = @adGroupId\n`;
      params.adGroupId = adGroupId;
    }

    sql += `
      GROUP BY ad_id
      ORDER BY name
    `;

    const rows = await this.bigQueryService.query(sql, params);

    return rows.map((row: any) => ({
      id: row.ad_id,
      adGroupId: row.ad_group_id,
      campaignId: row.campaign_id,
      name: row.name || `Ad ${row.ad_id}`,
      status: row.status,
      metrics: {
        impressions: row.impressions || 0,
        clicks: row.clicks || 0,
        spend: (row.cost_micros || 0) / 1000000,
        conversions: row.conversions || 0,
        ctr: this.calculateCtr(row.clicks, row.impressions),
        cpc: this.calculateCpc(row.cost_micros, row.clicks),
        cpm: this.calculateCpm(row.cost_micros, row.impressions),
      },
    }));
  }

  // ==================== METRICS ====================

  /**
   * Get account-level metrics from BigQuery
   */
  async getAccountMetrics(
    userId: number,
    startDate: string,
    endDate: string,
  ): Promise<PlatformMetrics> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId) {
      throw new UnauthorizedException('No valid session or customer selected');
    }

    return this.getAccountMetricsFromBigQuery(userId, session.customerId, startDate, endDate);
  }

  /**
   * Read account-level metrics from BigQuery
   */
  private async getAccountMetricsFromBigQuery(
    userId: number,
    customerId: string,
    startDate: string,
    endDate: string,
  ): Promise<PlatformMetrics> {
    const tableRef = this.bigQueryService.getTableRef('daily_account_metrics');
    const sql = `
      SELECT
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost_micros) as cost_micros,
        SUM(conversions) as conversions,
        SUM(conversions_value) as conversions_value
      FROM ${tableRef}
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
    `;

    const rows = await this.bigQueryService.query(sql, {
      userId,
      customerId,
      startDate,
      endDate,
    });

    const row = rows[0] || {};
    const totalSpend = (row.cost_micros || 0) / 1000000;
    const totalConversions = row.conversions || 0;
    const totalConversionsValue = row.conversions_value || 0;

    return {
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      spend: totalSpend,
      conversions: totalConversions,
      ctr: this.calculateCtr(row.clicks, row.impressions),
      cpc: this.calculateCpc(row.cost_micros, row.clicks),
      cpm: this.calculateCpm(row.cost_micros, row.impressions),
      roas: totalSpend > 0 ? totalConversionsValue / totalSpend : 0,
      costPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
    };
  }

  /**
   * Get metrics by date (for charts) from BigQuery
   */
  async getMetricsByDate(
    userId: number,
    startDate: string,
    endDate: string,
  ): Promise<{ date: string; metrics: PlatformMetrics }[]> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId) {
      throw new UnauthorizedException('No valid session or customer selected');
    }

    return this.getMetricsByDateFromBigQuery(userId, session.customerId, startDate, endDate);
  }

  /**
   * Read daily metrics from BigQuery
   */
  private async getMetricsByDateFromBigQuery(
    userId: number,
    customerId: string,
    startDate: string,
    endDate: string,
  ): Promise<{ date: string; metrics: PlatformMetrics }[]> {
    const tableRef = this.bigQueryService.getTableRef('daily_account_metrics');
    const sql = `
      SELECT
        date,
        SUM(impressions) as impressions,
        SUM(clicks) as clicks,
        SUM(cost_micros) as cost_micros,
        SUM(conversions) as conversions,
        SUM(conversions_value) as conversions_value
      FROM ${tableRef}
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
      GROUP BY date
      ORDER BY date
    `;

    const rows = await this.bigQueryService.query(sql, {
      userId,
      customerId,
      startDate,
      endDate,
    });

    return rows.map((row: any) => {
      // BigQuery DATE type returns as { value: 'YYYY-MM-DD' } object
      const dateStr = typeof row.date === 'object' && row.date?.value ? row.date.value : String(row.date);
      return {
        date: dateStr,
        metrics: {
          impressions: row.impressions || 0,
          clicks: row.clicks || 0,
          spend: (row.cost_micros || 0) / 1000000,
          conversions: row.conversions || 0,
          ctr: this.calculateCtr(row.clicks, row.impressions),
          cpc: this.calculateCpc(row.cost_micros, row.clicks),
          cpm: this.calculateCpm(row.cost_micros, row.impressions),
          roas: row.cost_micros > 0 ? (row.conversions_value || 0) / ((row.cost_micros || 0) / 1000000) : 0,
        },
      };
    });
  }

  // ==================== HELPER METHODS ====================

  /**
   * Make a Google Ads API request
   */
  private async makeApiRequest<T>(
    session: GoogleAdsSession,
    method: string,
    endpoint: string,
    body?: any,
  ): Promise<T> {
    const versionedEndpoint = endpoint.startsWith('/v') ? endpoint : `/${this.apiVersion}${endpoint}`;
    const url = `${GOOGLE_ADS_API_BASE}${versionedEndpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${session.accessToken}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    };

    if (session.loginCustomerId) {
      headers['login-customer-id'] = session.loginCustomerId.replace(/-/g, '');
    }

    const response = await fetch(url, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => 'Could not read response text');
      let errorData: any = {};
      try {
        errorData = JSON.parse(responseText);
      } catch (e) {
        errorData = { rawText: responseText };
      }
      this.logger.error(`Google Ads API error: ${response.status}`, errorData);
      throw new BadRequestException(errorData.error?.message || `Google Ads API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Make a Google Ads Search API request (GAQL query)
   */
  private async makeSearchRequest(
    session: GoogleAdsSession,
    customerId: string,
    query: string,
    pageToken?: string,
  ): Promise<GoogleAdsApiResponse<any>> {
    const cleanCustomerId = customerId.replace(/-/g, '');
    const url = `${GOOGLE_ADS_API_BASE}/v17/customers/${cleanCustomerId}/googleAds:search`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${session.accessToken}`,
      'developer-token': this.developerToken,
      'Content-Type': 'application/json',
    };

    if (session.loginCustomerId) {
      headers['login-customer-id'] = session.loginCustomerId.replace(/-/g, '');
    }

    const body: any = { query };
    if (pageToken) {
      body.pageToken = pageToken;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      this.logger.error(`Google Ads Search API error: ${response.status}`, errorData);
      throw new BadRequestException(
        errorData.error?.message || 'Google Ads query failed',
      );
    }

    return response.json();
  }

  // Calculation helpers
  private calculateCtr(clicks: any, impressions: any): number {
    const c = parseInt(clicks || '0', 10);
    const i = parseInt(impressions || '0', 10);
    return i > 0 ? (c / i) * 100 : 0;
  }

  private calculateCpc(costMicros: any, clicks: any): number {
    const cost = parseInt(costMicros || '0', 10) / 1000000;
    const c = parseInt(clicks || '0', 10);
    return c > 0 ? cost / c : 0;
  }

  private calculateCpm(costMicros: any, impressions: any): number {
    const cost = parseInt(costMicros || '0', 10) / 1000000;
    const i = parseInt(impressions || '0', 10);
    return i > 0 ? (cost / i) * 1000 : 0;
  }

  private calculateRoas(conversionsValue: any, costMicros: any): number {
    const value = parseFloat(conversionsValue || '0');
    const cost = parseInt(costMicros || '0', 10) / 1000000;
    return cost > 0 ? value / cost : 0;
  }
}
