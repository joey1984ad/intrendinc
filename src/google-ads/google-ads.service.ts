import { Injectable, Logger, UnauthorizedException, BadRequestException, ForbiddenException, Inject, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { GoogleAdsSession } from './entities/google-ads-session.entity';
import { GoogleAdsMetricsCache } from './entities/google-ads-metrics-cache.entity';
import { GoogleAdsCampaignData } from './entities/google-ads-campaign-data.entity';
import { PlatformMetrics, PlatformCampaign, PlatformAdGroup, PlatformAd } from '../common/interfaces/ad-platform.interface';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

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
  private readonly cacheTtlHours: number;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(GoogleAdsSession)
    private readonly sessionRepository: Repository<GoogleAdsSession>,
    @InjectRepository(GoogleAdsMetricsCache)
    private readonly metricsCacheRepository: Repository<GoogleAdsMetricsCache>,
    @InjectRepository(GoogleAdsCampaignData)
    private readonly campaignDataRepository: Repository<GoogleAdsCampaignData>,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
  ) {
    const googleAdsConfig = this.configService.get('googleAds');
    this.clientId = googleAdsConfig?.clientId || '';
    this.clientSecret = googleAdsConfig?.clientSecret || '';
    this.developerToken = googleAdsConfig?.developerToken || '';
    this.redirectUri = googleAdsConfig?.redirectUri || 'http://localhost:3001/google-ads/auth/callback';
    this.apiVersion = googleAdsConfig?.apiVersion || 'v18';
    this.scopes = googleAdsConfig?.scopes || [
      'https://www.googleapis.com/auth/adwords',
      'https://www.googleapis.com/auth/userinfo.email',
    ];
    this.cacheTtlHours = googleAdsConfig?.cacheTtlHours || 6;
  }

  // ==================== SUBSCRIPTION VALIDATION ====================

  /**
   * Check if user has paid access to any Google Ads accounts
   * Uses the organization seats with platform='google'
   */
  async validateSubscription(userId: number): Promise<void> {
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'google');

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
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'google');
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
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'google');
    return seats.map(seat => seat.adAccountId);
  }

  /**
   * Get subscription status for the user (Google Ads accounts)
   */
  async getSubscriptionStatus(userId: number): Promise<{
    hasSubscription: boolean;
    paidAccounts?: { id: string; name: string; addedAt: Date }[];
  }> {
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'google');

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
    if (!session) {
      throw new UnauthorizedException('No valid Google Ads session');
    }

    try {
      // First, get list of accessible customer IDs
      const listResponse = await this.makeApiRequest<{ resourceNames: string[] }>(
        session,
        'GET',
        '/v18/customers:listAccessibleCustomers',
      );

      if (!listResponse.resourceNames?.length) {
        return [];
      }

      // For each customer, get details
      const customers: GoogleAdsCustomer[] = [];

      for (const resourceName of listResponse.resourceNames) {
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
      const response = await this.makeSearchRequest(session, customerId, query);
      const result = response.results?.[0];
      
      if (result?.customer) {
        return {
          resourceName: `customers/${customerId}`,
          id: result.customer.id,
          descriptiveName: result.customer.descriptiveName || `Account ${customerId}`,
          currencyCode: result.customer.currencyCode,
          timeZone: result.customer.timeZone,
          manager: result.customer.manager || false,
          testAccount: result.customer.testAccount || false,
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
   * Get campaigns for the selected customer
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

    const dateClause = startDate && endDate
      ? `WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`
      : '';

    const query = `
      SELECT 
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
      ${dateClause}
      ORDER BY campaign.name
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);

    return (response.results || []).map((result: any) => ({
      id: result.campaign.id,
      name: result.campaign.name,
      status: result.campaign.status,
      objective: result.campaign.advertisingChannelType,
      budget: result.campaignBudget?.amountMicros ? result.campaignBudget.amountMicros / 1000000 : 0,
      budgetType: result.campaignBudget?.type === 'DAILY' ? 'daily' : 'lifetime',
      startTime: result.campaign.startDate ? new Date(result.campaign.startDate) : undefined,
      endTime: result.campaign.endDate ? new Date(result.campaign.endDate) : undefined,
      metrics: {
        impressions: parseInt(result.metrics?.impressions || '0', 10),
        clicks: parseInt(result.metrics?.clicks || '0', 10),
        spend: (result.metrics?.costMicros || 0) / 1000000,
        conversions: parseFloat(result.metrics?.conversions || '0'),
        ctr: this.calculateCtr(result.metrics?.clicks, result.metrics?.impressions),
        cpc: this.calculateCpc(result.metrics?.costMicros, result.metrics?.clicks),
        cpm: this.calculateCpm(result.metrics?.costMicros, result.metrics?.impressions),
        roas: this.calculateRoas(result.metrics?.conversionsValue, result.metrics?.costMicros),
      },
    }));
  }

  /**
   * Get single campaign by ID
   */
  async getCampaign(userId: number, campaignId: string): Promise<PlatformCampaign | null> {
    const session = await this.getSession(userId);
    if (!session || !session.customerId) {
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

    const response = await this.makeSearchRequest(session, session.customerId, query);
    const result = response.results?.[0];

    if (!result) return null;

    return {
      id: result.campaign.id,
      name: result.campaign.name,
      status: result.campaign.status,
      objective: result.campaign.advertisingChannelType,
      budget: result.campaignBudget?.amountMicros ? result.campaignBudget.amountMicros / 1000000 : 0,
      metrics: {
        impressions: parseInt(result.metrics?.impressions || '0', 10),
        clicks: parseInt(result.metrics?.clicks || '0', 10),
        spend: (result.metrics?.costMicros || 0) / 1000000,
        conversions: parseFloat(result.metrics?.conversions || '0'),
        ctr: this.calculateCtr(result.metrics?.clicks, result.metrics?.impressions),
        cpc: this.calculateCpc(result.metrics?.costMicros, result.metrics?.clicks),
        cpm: this.calculateCpm(result.metrics?.costMicros, result.metrics?.impressions),
      },
    };
  }

  // ==================== AD GROUPS ====================

  /**
   * Get ad groups
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

    const whereClauses: string[] = [];
    if (campaignId) {
      whereClauses.push(`campaign.id = ${campaignId}`);
    }
    if (startDate && endDate) {
      whereClauses.push(`segments.date BETWEEN '${startDate}' AND '${endDate}'`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT 
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
      ${whereClause}
      ORDER BY ad_group.name
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);

    return (response.results || []).map((result: any) => ({
      id: result.adGroup.id,
      campaignId: result.campaign.id,
      name: result.adGroup.name,
      status: result.adGroup.status,
      bidAmount: result.adGroup.cpcBidMicros ? result.adGroup.cpcBidMicros / 1000000 : 0,
      metrics: {
        impressions: parseInt(result.metrics?.impressions || '0', 10),
        clicks: parseInt(result.metrics?.clicks || '0', 10),
        spend: (result.metrics?.costMicros || 0) / 1000000,
        conversions: parseFloat(result.metrics?.conversions || '0'),
        ctr: this.calculateCtr(result.metrics?.clicks, result.metrics?.impressions),
        cpc: this.calculateCpc(result.metrics?.costMicros, result.metrics?.clicks),
        cpm: this.calculateCpm(result.metrics?.costMicros, result.metrics?.impressions),
      },
    }));
  }

  // ==================== ADS ====================

  /**
   * Get ads
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

    const whereClauses: string[] = [];
    if (adGroupId) {
      whereClauses.push(`ad_group.id = ${adGroupId}`);
    }
    if (startDate && endDate) {
      whereClauses.push(`segments.date BETWEEN '${startDate}' AND '${endDate}'`);
    }

    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const query = `
      SELECT 
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
      ${whereClause}
      ORDER BY ad_group_ad.ad.name
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);

    return (response.results || []).map((result: any) => ({
      id: result.adGroupAd.ad.id,
      adGroupId: result.adGroup.id,
      campaignId: result.campaign.id,
      name: result.adGroupAd.ad.name || `Ad ${result.adGroupAd.ad.id}`,
      status: result.adGroupAd.status,
      metrics: {
        impressions: parseInt(result.metrics?.impressions || '0', 10),
        clicks: parseInt(result.metrics?.clicks || '0', 10),
        spend: (result.metrics?.costMicros || 0) / 1000000,
        conversions: parseFloat(result.metrics?.conversions || '0'),
        ctr: this.calculateCtr(result.metrics?.clicks, result.metrics?.impressions),
        cpc: this.calculateCpc(result.metrics?.costMicros, result.metrics?.clicks),
        cpm: this.calculateCpm(result.metrics?.costMicros, result.metrics?.impressions),
      },
    }));
  }

  // ==================== METRICS ====================

  /**
   * Get account-level metrics
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

    // Check cache first
    const cacheKey = `${startDate}_${endDate}`;
    const cached = await this.metricsCacheRepository.findOne({
      where: {
        userId,
        customerId: session.customerId,
        dateRange: cacheKey,
        expiresAt: MoreThan(new Date()),
      },
    });

    if (cached) {
      return cached.metricsData;
    }

    const query = `
      SELECT 
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);

    // Aggregate metrics
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalCostMicros = 0;
    let totalConversions = 0;
    let totalConversionsValue = 0;

    for (const result of response.results || []) {
      totalImpressions += parseInt(result.metrics?.impressions || '0', 10);
      totalClicks += parseInt(result.metrics?.clicks || '0', 10);
      totalCostMicros += parseInt(result.metrics?.costMicros || '0', 10);
      totalConversions += parseFloat(result.metrics?.conversions || '0');
      totalConversionsValue += parseFloat(result.metrics?.conversionsValue || '0');
    }

    const totalSpend = totalCostMicros / 1000000;

    const metrics: PlatformMetrics = {
      impressions: totalImpressions,
      clicks: totalClicks,
      spend: totalSpend,
      conversions: totalConversions,
      ctr: this.calculateCtr(totalClicks, totalImpressions),
      cpc: this.calculateCpc(totalCostMicros, totalClicks),
      cpm: this.calculateCpm(totalCostMicros, totalImpressions),
      roas: totalSpend > 0 ? totalConversionsValue / totalSpend : 0,
      costPerConversion: totalConversions > 0 ? totalSpend / totalConversions : 0,
    };

    // Cache the results
    const cacheExpiry = new Date();
    cacheExpiry.setHours(cacheExpiry.getHours() + this.cacheTtlHours);

    await this.metricsCacheRepository.save({
      userId,
      customerId: session.customerId,
      dateRange: cacheKey,
      metricsData: metrics as any,
      expiresAt: cacheExpiry,
    });

    return metrics;
  }

  /**
   * Get metrics by date (for charts)
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

    const query = `
      SELECT 
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros,
        metrics.conversions,
        metrics.conversions_value
      FROM customer
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY segments.date
    `;

    const response = await this.makeSearchRequest(session, session.customerId, query);

    // Group by date
    const dateMetrics: Map<string, any> = new Map();

    for (const result of response.results || []) {
      const date = result.segments?.date;
      if (!date) continue;

      if (!dateMetrics.has(date)) {
        dateMetrics.set(date, {
          impressions: 0,
          clicks: 0,
          costMicros: 0,
          conversions: 0,
          conversionsValue: 0,
        });
      }

      const current = dateMetrics.get(date);
      current.impressions += parseInt(result.metrics?.impressions || '0', 10);
      current.clicks += parseInt(result.metrics?.clicks || '0', 10);
      current.costMicros += parseInt(result.metrics?.costMicros || '0', 10);
      current.conversions += parseFloat(result.metrics?.conversions || '0');
      current.conversionsValue += parseFloat(result.metrics?.conversionsValue || '0');
    }

    return Array.from(dateMetrics.entries()).map(([date, data]) => ({
      date,
      metrics: {
        impressions: data.impressions,
        clicks: data.clicks,
        spend: data.costMicros / 1000000,
        conversions: data.conversions,
        ctr: this.calculateCtr(data.clicks, data.impressions),
        cpc: this.calculateCpc(data.costMicros, data.clicks),
        cpm: this.calculateCpm(data.costMicros, data.impressions),
        roas: data.costMicros > 0 ? data.conversionsValue / (data.costMicros / 1000000) : 0,
      },
    }));
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
    const url = `${GOOGLE_ADS_API_BASE}${endpoint}`;

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
      const errorData = await response.json().catch(() => ({}));
      this.logger.error(`Google Ads API error: ${response.status}`, errorData);
      throw new BadRequestException(errorData.error?.message || 'Google Ads API request failed');
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
    const url = `${GOOGLE_ADS_API_BASE}/v18/customers/${cleanCustomerId}/googleAds:search`;

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
