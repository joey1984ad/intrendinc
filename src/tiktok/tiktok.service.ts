import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Inject, forwardRef, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { TikTokSession } from './entities/tiktok-session.entity';
import { TikTokMetricsCache } from './entities/tiktok-metrics-cache.entity';
import { TikTokCreativesCache } from './entities/tiktok-creatives-cache.entity';
import { TikTokCampaignData } from './entities/tiktok-campaign-data.entity';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { 
  AdPlatform, 
  PlatformSession, 
  PlatformMetrics, 
  PlatformCampaign, 
  PlatformAdGroup, 
  PlatformAd,
  PlatformDateRange,
  PlatformApiResponse,
} from '../common/interfaces/ad-platform.interface';

interface TikTokApiResponse<T = any> {
  code: number;
  message: string;
  data: T;
  request_id?: string;
}

interface TikTokCampaignApiData {
  campaign_id: string;
  campaign_name: string;
  campaign_status: string;
  objective_type: string;
  budget: number;
  budget_mode: string;
  create_time: string;
  modify_time: string;
}

interface TikTokAdGroupApiData {
  adgroup_id: string;
  adgroup_name: string;
  adgroup_status: string;
  campaign_id: string;
  budget: number;
  bid_price: number;
  placement_type: string;
}

interface TikTokAdApiData {
  ad_id: string;
  ad_name: string;
  ad_status: string;
  adgroup_id: string;
  campaign_id: string;
  creative_id: string;
  ad_text: string;
  image_ids: string[];
  video_id: string;
}

interface TikTokMetricsApiData {
  metrics: {
    impressions: string;
    clicks: string;
    spend: string;
    reach?: string;
    frequency?: string;
    cpc: string;
    cpm: string;
    ctr: string;
    conversion?: string;
    cost_per_conversion?: string;
    total_purchase_value?: string;
  };
  dimensions: {
    stat_time_day?: string;
    campaign_id?: string;
    adgroup_id?: string;
    ad_id?: string;
  };
}

@Injectable()
export class TikTokService {
  private readonly logger = new Logger(TikTokService.name);
  private readonly platform = AdPlatform.TIKTOK;
  private readonly apiVersion = 'v1.3';
  private readonly baseUrl = 'https://business-api.tiktok.com/open_api';
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    @InjectRepository(TikTokSession)
    private sessionRepository: Repository<TikTokSession>,
    @InjectRepository(TikTokMetricsCache)
    private metricsCacheRepository: Repository<TikTokMetricsCache>,
    @InjectRepository(TikTokCreativesCache)
    private creativesCacheRepository: Repository<TikTokCreativesCache>,
    @InjectRepository(TikTokCampaignData)
    private campaignDataRepository: Repository<TikTokCampaignData>,
    private configService: ConfigService,
    @Inject(forwardRef(() => SubscriptionsService))
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  // ==================== SUBSCRIPTION VALIDATION ====================

  /**
   * Check if user has paid access to any TikTok Ads accounts
   */
  async validateSubscription(userId: number): Promise<void> {
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'tiktok');

    if (seats.length === 0) {
      throw new ForbiddenException(
        'No active TikTok Ads subscriptions. Please subscribe to at least one TikTok Ads account.',
      );
    }
  }

  /**
   * Check if user can access a specific TikTok advertiser account
   */
  async validateAdvertiserAccess(userId: number, advertiserId: string): Promise<void> {
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'tiktok');
    const hasAccess = seats.some(seat => seat.adAccountId === advertiserId);

    if (!hasAccess) {
      throw new ForbiddenException(
        'This TikTok advertiser account is not included in your subscription. Please add it to your plan.',
      );
    }
  }

  /**
   * Get list of TikTok advertiser accounts user has paid access to
   */
  async getPaidAdvertiserIds(userId: number): Promise<string[]> {
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'tiktok');
    return seats.map(seat => seat.adAccountId);
  }

  /**
   * Get subscription status for TikTok Ads
   */
  async getSubscriptionStatus(userId: number): Promise<{
    hasSubscription: boolean;
    advertiserIds: string[];
    planType?: string;
  }> {
    const seats = await this.subscriptionsService.getOrganizationSeats(userId, 'tiktok');
    
    if (seats.length === 0) {
      return {
        hasSubscription: false,
        advertiserIds: [],
      };
    }

    return {
      hasSubscription: true,
      advertiserIds: seats.map(seat => seat.adAccountId),
      planType: seats[0]?.organizationSubscription?.planName,
    };
  }

  // ==================== SESSION MANAGEMENT ====================

  async saveSession(
    userId: number,
    accessToken: string,
    refreshToken?: string,
    advertiserId?: string,
    advertiserName?: string,
    tokenExpiresAt?: Date,
    refreshTokenExpiresAt?: Date,
  ): Promise<TikTokSession> {
    let session = await this.sessionRepository.findOneBy({ userId });
    
    if (session) {
      session.accessToken = accessToken;
      session.refreshToken = refreshToken || session.refreshToken;
      session.advertiserId = advertiserId || session.advertiserId;
      session.advertiserName = advertiserName || session.advertiserName;
      session.tokenExpiresAt = tokenExpiresAt || session.tokenExpiresAt;
      session.refreshTokenExpiresAt = refreshTokenExpiresAt || session.refreshTokenExpiresAt;
    } else {
      session = this.sessionRepository.create({
        userId,
        accessToken,
        refreshToken,
        advertiserId,
        advertiserName,
        tokenExpiresAt,
        refreshTokenExpiresAt,
      });
    }
    
    return this.sessionRepository.save(session);
  }

  async getSession(userId: number): Promise<TikTokSession | null> {
    return this.sessionRepository.findOneBy({ userId });
  }

  async deleteSession(userId: number): Promise<void> {
    await this.sessionRepository.delete({ userId });
  }

  async refreshAccessToken(userId: number): Promise<TikTokSession> {
    const session = await this.getSession(userId);
    if (!session || !session.refreshToken) {
      if (session) {
        this.logger.warn(`Invalid session found for user ${userId}, cleaning up`);
        await this.deleteSession(userId);
      }
      throw new UnauthorizedException('No session or refresh token found');
    }

    const appId = this.configService.get<string>('tiktok.appId');
    const appSecret = this.configService.get<string>('tiktok.appSecret');

    const response = await fetch(`${this.baseUrl}/${this.apiVersion}/oauth2/refresh_token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_id: appId,
        secret: appSecret,
        refresh_token: session.refreshToken,
      }),
    });

    const data: TikTokApiResponse = await response.json();
    
    if (data.code !== 0) {
      this.logger.warn(`Token refresh failed for user ${userId}: ${data.message} (Code: ${data.code}), cleaning up session`);
      await this.deleteSession(userId);
      throw new UnauthorizedException(`Token refresh failed: ${data.message}`);
    }

    const tokenExpiresAt = new Date(Date.now() + data.data.expires_in * 1000);
    const refreshTokenExpiresAt = new Date(Date.now() + data.data.refresh_token_expires_in * 1000);

    return this.saveSession(
      userId,
      data.data.access_token,
      data.data.refresh_token,
      session.advertiserId,
      session.advertiserName,
      tokenExpiresAt,
      refreshTokenExpiresAt,
    );
  }

  // ==================== ADVERTISER MANAGEMENT ====================

  async getAdvertiserInfo(accessToken: string, advertiserId: string): Promise<any> {
    const url = `${this.baseUrl}/${this.apiVersion}/advertiser/info/`;
    const response = await this.makeApiCall<TikTokApiResponse>(url, accessToken, {
      advertiser_ids: JSON.stringify([advertiserId]),
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get advertiser info: ${response.message}`);
    }

    return response.data.list?.[0] || null;
  }

  async getAuthorizedAdvertisers(accessToken: string, appId: string): Promise<any[]> {
    const url = `${this.baseUrl}/${this.apiVersion}/oauth2/advertiser/get/`;
    const response = await this.makeApiCall<TikTokApiResponse>(url, accessToken, {
      app_id: appId,
      secret: this.configService.get<string>('tiktok.appSecret'),
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get advertisers: ${response.message}`);
    }

    return response.data.list || [];
  }

  // ==================== CAMPAIGN OPERATIONS ====================

  async getCampaigns(
    accessToken: string,
    advertiserId: string,
    dateRange?: PlatformDateRange,
  ): Promise<PlatformApiResponse<PlatformCampaign[]>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/campaign/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokCampaignApiData[]; page_info: any }>>(
        url,
        accessToken,
        {
          advertiser_id: advertiserId,
          page_size: 100,
        },
      );

      if (response.code !== 0) {
        return { success: false, error: response.message };
      }

      const campaigns: PlatformCampaign[] = response.data.list.map((c) => ({
        id: c.campaign_id,
        name: c.campaign_name,
        status: c.campaign_status,
        objective: c.objective_type,
        budget: c.budget,
        budgetType: c.budget_mode === 'BUDGET_MODE_DAY' ? 'daily' : 'lifetime',
      }));

      // Fetch metrics if date range provided
      if (dateRange) {
        const metricsResponse = await this.getCampaignMetricsBulk(accessToken, advertiserId, campaigns.map(c => c.id), dateRange);
        if (metricsResponse.success && metricsResponse.data) {
          campaigns.forEach((campaign) => {
            campaign.metrics = metricsResponse.data![campaign.id];
          });
        }
      }

      return {
        success: true,
        data: campaigns,
        pagination: {
          hasMore: response.data.page_info?.total_page > response.data.page_info?.page,
          totalCount: response.data.page_info?.total_number,
        },
      };
    } catch (error: any) {
      this.logger.error('Failed to get campaigns', error);
      return { success: false, error: error.message };
    }
  }

  async getCampaign(accessToken: string, campaignId: string): Promise<PlatformApiResponse<PlatformCampaign>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/campaign/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokCampaignApiData[] }>>(
        url,
        accessToken,
        {
          campaign_ids: JSON.stringify([campaignId]),
        },
      );

      if (response.code !== 0 || !response.data.list?.[0]) {
        return { success: false, error: response.message || 'Campaign not found' };
      }

      const c = response.data.list[0];
      return {
        success: true,
        data: {
          id: c.campaign_id,
          name: c.campaign_name,
          status: c.campaign_status,
          objective: c.objective_type,
          budget: c.budget,
          budgetType: c.budget_mode === 'BUDGET_MODE_DAY' ? 'daily' : 'lifetime',
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== AD GROUP OPERATIONS ====================

  async getAdGroups(
    accessToken: string,
    advertiserId: string,
    campaignId?: string,
    dateRange?: PlatformDateRange,
  ): Promise<PlatformApiResponse<PlatformAdGroup[]>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/adgroup/get/`;
      const params: Record<string, any> = {
        advertiser_id: advertiserId,
        page_size: 100,
      };

      if (campaignId) {
        params.filtering = JSON.stringify({ campaign_ids: [campaignId] });
      }

      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokAdGroupApiData[]; page_info: any }>>(
        url,
        accessToken,
        params,
      );

      if (response.code !== 0) {
        return { success: false, error: response.message };
      }

      const adGroups: PlatformAdGroup[] = response.data.list.map((ag) => ({
        id: ag.adgroup_id,
        campaignId: ag.campaign_id,
        name: ag.adgroup_name,
        status: ag.adgroup_status,
        budget: ag.budget,
        bidAmount: ag.bid_price,
      }));

      return {
        success: true,
        data: adGroups,
        pagination: {
          hasMore: response.data.page_info?.total_page > response.data.page_info?.page,
          totalCount: response.data.page_info?.total_number,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getAdGroup(accessToken: string, adGroupId: string): Promise<PlatformApiResponse<PlatformAdGroup>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/adgroup/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokAdGroupApiData[] }>>(
        url,
        accessToken,
        {
          adgroup_ids: JSON.stringify([adGroupId]),
        },
      );

      if (response.code !== 0 || !response.data.list?.[0]) {
        return { success: false, error: response.message || 'Ad group not found' };
      }

      const ag = response.data.list[0];
      return {
        success: true,
        data: {
          id: ag.adgroup_id,
          campaignId: ag.campaign_id,
          name: ag.adgroup_name,
          status: ag.adgroup_status,
          budget: ag.budget,
          bidAmount: ag.bid_price,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== AD OPERATIONS ====================

  async getAds(
    accessToken: string,
    advertiserId: string,
    adGroupId?: string,
    dateRange?: PlatformDateRange,
  ): Promise<PlatformApiResponse<PlatformAd[]>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/ad/get/`;
      const params: Record<string, any> = {
        advertiser_id: advertiserId,
        page_size: 100,
      };

      if (adGroupId) {
        params.filtering = JSON.stringify({ adgroup_ids: [adGroupId] });
      }

      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokAdApiData[]; page_info: any }>>(
        url,
        accessToken,
        params,
      );

      if (response.code !== 0) {
        return { success: false, error: response.message };
      }

      const ads: PlatformAd[] = response.data.list.map((ad) => ({
        id: ad.ad_id,
        adGroupId: ad.adgroup_id,
        campaignId: ad.campaign_id,
        name: ad.ad_name,
        status: ad.ad_status,
        creativeId: ad.creative_id,
      }));

      return {
        success: true,
        data: ads,
        pagination: {
          hasMore: response.data.page_info?.total_page > response.data.page_info?.page,
          totalCount: response.data.page_info?.total_number,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getAd(accessToken: string, adId: string): Promise<PlatformApiResponse<PlatformAd>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/ad/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokAdApiData[] }>>(
        url,
        accessToken,
        {
          ad_ids: JSON.stringify([adId]),
        },
      );

      if (response.code !== 0 || !response.data.list?.[0]) {
        return { success: false, error: response.message || 'Ad not found' };
      }

      const ad = response.data.list[0];
      return {
        success: true,
        data: {
          id: ad.ad_id,
          adGroupId: ad.adgroup_id,
          campaignId: ad.campaign_id,
          name: ad.ad_name,
          status: ad.ad_status,
          creativeId: ad.creative_id,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== METRICS ====================

  async getAccountMetrics(
    accessToken: string,
    advertiserId: string,
    dateRange: PlatformDateRange,
  ): Promise<PlatformApiResponse<PlatformMetrics>> {
    const cacheKey = `account_${advertiserId}_${dateRange.since}_${dateRange.until}`;
    const cached = await this.getCachedMetrics(advertiserId, 'account', null, `${dateRange.since}_${dateRange.until}`);
    
    if (cached) {
      return { success: true, data: cached };
    }

    try {
      const url = `${this.baseUrl}/${this.apiVersion}/report/integrated/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokMetricsApiData[] }>>(
        url,
        accessToken,
        {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          dimensions: JSON.stringify(['advertiser_id']),
          data_level: 'AUCTION_ADVERTISER',
          start_date: dateRange.since,
          end_date: dateRange.until,
          metrics: JSON.stringify([
            'spend', 'impressions', 'clicks', 'reach', 'frequency',
            'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
          ]),
        },
      );

      if (response.code !== 0) {
        return { success: false, error: response.message };
      }

      const metrics = this.transformMetrics(response.data.list?.[0]?.metrics);
      await this.cacheMetrics(advertiserId, 'account', null, `${dateRange.since}_${dateRange.until}`, metrics);

      return { success: true, data: metrics };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getCampaignMetricsBulk(
    accessToken: string,
    advertiserId: string,
    campaignIds: string[],
    dateRange: PlatformDateRange,
  ): Promise<PlatformApiResponse<Record<string, PlatformMetrics>>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/report/integrated/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokMetricsApiData[] }>>(
        url,
        accessToken,
        {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          dimensions: JSON.stringify(['campaign_id']),
          data_level: 'AUCTION_CAMPAIGN',
          start_date: dateRange.since,
          end_date: dateRange.until,
          filtering: JSON.stringify({ campaign_ids: campaignIds }),
          metrics: JSON.stringify([
            'spend', 'impressions', 'clicks', 'reach', 'frequency',
            'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
          ]),
        },
      );

      if (response.code !== 0) {
        return { success: false, error: response.message };
      }

      const metricsMap: Record<string, PlatformMetrics> = {};
      response.data.list?.forEach((item) => {
        const campaignId = item.dimensions.campaign_id;
        if (campaignId) {
          metricsMap[campaignId] = this.transformMetrics(item.metrics);
        }
      });

      return { success: true, data: metricsMap };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  // ==================== CREATIVES ====================

  async getCreatives(
    accessToken: string,
    advertiserId: string,
    dateRange?: PlatformDateRange,
  ): Promise<PlatformApiResponse<any[]>> {
    try {
      // First, get all ads to extract creative IDs
      const adsResult = await this.getAds(accessToken, advertiserId, undefined, dateRange);
      
      if (!adsResult.success || !adsResult.data) {
        return { success: false, error: adsResult.error || 'Failed to fetch ads' };
      }

      const creativeIds = [...new Set(adsResult.data.map(ad => ad.creativeId).filter((id): id is string => !!id))];
      
      if (creativeIds.length === 0) {
        return { success: true, data: [] };
      }

      // Fetch creative details for each unique creative ID
      const creatives = await Promise.all(
        creativeIds.map(async (creativeId) => {
          try {
            const creative = await this.getCreativeInfo(accessToken, advertiserId, creativeId);
            return {
              id: creativeId,
              ...creative,
            };
          } catch (error) {
            this.logger.warn(`Failed to fetch creative ${creativeId}: ${error.message}`);
            return null;
          }
        })
      );

      const validCreatives = creatives.filter(c => c !== null);

      return {
        success: true,
        data: validCreatives,
        pagination: {
          totalCount: validCreatives.length,
          hasMore: false,
        },
      };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  async getCreativeInfo(accessToken: string, advertiserId: string, creativeId: string): Promise<any> {
    const url = `${this.baseUrl}/${this.apiVersion}/creative/get/`;
    const response = await this.makeApiCall<TikTokApiResponse>(url, accessToken, {
      advertiser_id: advertiserId,
      creative_id: creativeId,
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get creative: ${response.message}`);
    }

    return response.data;
  }

  async getVideoInfo(accessToken: string, advertiserId: string, videoId: string): Promise<any> {
    const url = `${this.baseUrl}/${this.apiVersion}/file/video/info/`;
    const response = await this.makeApiCall<TikTokApiResponse>(url, accessToken, {
      advertiser_id: advertiserId,
      video_ids: JSON.stringify([videoId]),
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get video info: ${response.message}`);
    }

    return response.data.list?.[0] || null;
  }

  async getImageInfo(accessToken: string, advertiserId: string, imageId: string): Promise<any> {
    const url = `${this.baseUrl}/${this.apiVersion}/file/image/info/`;
    const response = await this.makeApiCall<TikTokApiResponse>(url, accessToken, {
      advertiser_id: advertiserId,
      image_ids: JSON.stringify([imageId]),
    });

    if (response.code !== 0) {
      throw new Error(`Failed to get image info: ${response.message}`);
    }

    return response.data.list?.[0] || null;
  }

  // ==================== DEMOGRAPHICS ====================

  async getDemographics(
    accessToken: string,
    advertiserId: string,
    dateRange: PlatformDateRange,
  ): Promise<PlatformApiResponse<any>> {
    try {
      // Get age breakdown
      const ageUrl = `${this.baseUrl}/${this.apiVersion}/report/integrated/get/`;
      const ageResponse = await this.makeApiCall<TikTokApiResponse<{ list: any[] }>>(
        ageUrl,
        accessToken,
        {
          advertiser_id: advertiserId,
          report_type: 'AUDIENCE',
          dimensions: JSON.stringify(['age']),
          data_level: 'AUCTION_ADVERTISER',
          start_date: dateRange.since,
          end_date: dateRange.until,
          metrics: JSON.stringify([
            'spend', 'impressions', 'clicks', 'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
          ]),
        },
      );

      // Get gender breakdown
      const genderResponse = await this.makeApiCall<TikTokApiResponse<{ list: any[] }>>(
        ageUrl,
        accessToken,
        {
          advertiser_id: advertiserId,
          report_type: 'AUDIENCE',
          dimensions: JSON.stringify(['gender']),
          data_level: 'AUCTION_ADVERTISER',
          start_date: dateRange.since,
          end_date: dateRange.until,
          metrics: JSON.stringify([
            'spend', 'impressions', 'clicks', 'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
          ]),
        },
      );

      // Get platform/device breakdown
      const platformResponse = await this.makeApiCall<TikTokApiResponse<{ list: any[] }>>(
        ageUrl,
        accessToken,
        {
          advertiser_id: advertiserId,
          report_type: 'AUDIENCE',
          dimensions: JSON.stringify(['platform']),
          data_level: 'AUCTION_ADVERTISER',
          start_date: dateRange.since,
          end_date: dateRange.until,
          metrics: JSON.stringify([
            'spend', 'impressions', 'clicks', 'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
          ]),
        },
      );

      const demographics = {
        byAge: this.transformDemographicData(ageResponse.data?.list || [], 'age'),
        byGender: this.transformDemographicData(genderResponse.data?.list || [], 'gender'),
        byPlatform: this.transformDemographicData(platformResponse.data?.list || [], 'platform'),
      };

      return { success: true, data: demographics };
    } catch (error: any) {
      this.logger.error('Failed to get demographics', error);
      return { success: false, error: error.message };
    }
  }

  private transformDemographicData(data: any[], dimensionKey: string): any[] {
    return data.map(item => ({
      [dimensionKey]: item.dimensions?.[dimensionKey] || 'Unknown',
      impressions: parseFloat(item.metrics?.impressions) || 0,
      clicks: parseFloat(item.metrics?.clicks) || 0,
      spend: parseFloat(item.metrics?.spend) || 0,
      ctr: parseFloat(item.metrics?.ctr) || 0,
      cpc: parseFloat(item.metrics?.cpc) || 0,
      conversions: parseFloat(item.metrics?.conversion) || 0,
      costPerConversion: parseFloat(item.metrics?.cost_per_conversion) || 0,
    }));
  }

  // ==================== DAILY METRICS ====================

  async getDailyMetrics(
    accessToken: string,
    advertiserId: string,
    dateRange: PlatformDateRange,
  ): Promise<PlatformApiResponse<any[]>> {
    try {
      const url = `${this.baseUrl}/${this.apiVersion}/report/integrated/get/`;
      const response = await this.makeApiCall<TikTokApiResponse<{ list: TikTokMetricsApiData[] }>>(
        url,
        accessToken,
        {
          advertiser_id: advertiserId,
          report_type: 'BASIC',
          dimensions: JSON.stringify(['stat_time_day']),
          data_level: 'AUCTION_ADVERTISER',
          start_date: dateRange.since,
          end_date: dateRange.until,
          metrics: JSON.stringify([
            'spend', 'impressions', 'clicks', 'reach', 'frequency',
            'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
          ]),
        },
      );

      if (response.code !== 0) {
        return { success: false, error: response.message };
      }

      const dailyMetrics = response.data.list?.map(item => ({
        date: item.dimensions?.stat_time_day,
        ...this.transformMetrics(item.metrics),
      })).sort((a, b) => a.date?.localeCompare(b.date || '') || 0);

      return { success: true, data: dailyMetrics || [] };
    } catch (error: any) {
      this.logger.error('Failed to get daily metrics', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== CREATIVES WITH METRICS ====================

  async getCreativesWithMetrics(
    accessToken: string,
    advertiserId: string,
    dateRange?: PlatformDateRange,
  ): Promise<PlatformApiResponse<any[]>> {
    try {
      // First, get all ads with creative info
      const adsResult = await this.getAds(accessToken, advertiserId, undefined, dateRange);
      
      if (!adsResult.success || !adsResult.data) {
        return { success: false, error: adsResult.error || 'Failed to fetch ads' };
      }

      // Get ad-level metrics
      const effectiveDateRange = dateRange || {
        since: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        until: new Date().toISOString().split('T')[0],
      };

      const metricsUrl = `${this.baseUrl}/${this.apiVersion}/report/integrated/get/`;
      const adIds = adsResult.data.map(ad => ad.id);
      
      let adMetrics: Record<string, any> = {};
      
      if (adIds.length > 0) {
        const metricsResponse = await this.makeApiCall<TikTokApiResponse<{ list: TikTokMetricsApiData[] }>>(
          metricsUrl,
          accessToken,
          {
            advertiser_id: advertiserId,
            report_type: 'BASIC',
            dimensions: JSON.stringify(['ad_id']),
            data_level: 'AUCTION_AD',
            start_date: effectiveDateRange.since,
            end_date: effectiveDateRange.until,
            filtering: JSON.stringify({ ad_ids: adIds }),
            metrics: JSON.stringify([
              'spend', 'impressions', 'clicks', 'reach', 'frequency',
              'cpc', 'cpm', 'ctr', 'conversion', 'cost_per_conversion',
            ]),
          },
        );

        if (metricsResponse.code === 0 && metricsResponse.data?.list) {
          metricsResponse.data.list.forEach(item => {
            const adId = item.dimensions?.ad_id;
            if (adId) {
              adMetrics[adId] = this.transformMetrics(item.metrics);
            }
          });
        }
      }

      // Combine ads with their metrics and fetch creative details
      const creativesWithMetrics = await Promise.all(
        adsResult.data.map(async (ad) => {
          let creativeDetails: any = null;
          let videoInfo: any = null;
          let imageInfo: any = null;

          // Try to get creative details if creativeId exists
          if (ad.creativeId) {
            try {
              creativeDetails = await this.getCreativeInfo(accessToken, advertiserId, ad.creativeId);
              
              // Get video or image info based on creative type
              if (creativeDetails?.video_id) {
                videoInfo = await this.getVideoInfo(accessToken, advertiserId, creativeDetails.video_id);
              }
              if (creativeDetails?.image_ids?.[0]) {
                imageInfo = await this.getImageInfo(accessToken, advertiserId, creativeDetails.image_ids[0]);
              }
            } catch (e) {
              // Continue without creative details
            }
          }

          return {
            id: ad.id,
            adId: ad.id,
            name: ad.name,
            status: ad.status,
            creativeId: ad.creativeId,
            creativeType: videoInfo ? 'video' : 'image',
            thumbnailUrl: videoInfo?.poster_url || imageInfo?.url || creativeDetails?.thumbnail_url,
            videoUrl: videoInfo?.video_url,
            imageUrl: imageInfo?.url,
            adText: creativeDetails?.ad_text,
            callToAction: creativeDetails?.call_to_action,
            metrics: adMetrics[ad.id] || {
              impressions: 0,
              clicks: 0,
              spend: 0,
              cpc: 0,
              cpm: 0,
              ctr: 0,
              conversions: 0,
            },
          };
        }),
      );

      return {
        success: true,
        data: creativesWithMetrics,
        pagination: {
          totalCount: creativesWithMetrics.length,
          hasMore: false,
        },
      };
    } catch (error: any) {
      this.logger.error('Failed to get creatives with metrics', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== CACHING ====================

  private async getCachedMetrics(
    advertiserId: string,
    metricType: string,
    entityId: string | null,
    dateRange: string,
  ): Promise<PlatformMetrics | null> {
    const cached = await this.metricsCacheRepository.findOne({
      where: {
        advertiserId,
        metricType,
        entityId: entityId || undefined,
        dateRange,
        expiresAt: LessThan(new Date()),
      },
    });

    if (cached && new Date() < cached.expiresAt) {
      return cached.metricData as unknown as PlatformMetrics;
    }

    return null;
  }

  private async cacheMetrics(
    advertiserId: string,
    metricType: string,
    entityId: string | null,
    dateRange: string,
    metrics: PlatformMetrics,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + this.cacheTTL);
    
    let cache = await this.metricsCacheRepository.findOne({
      where: { advertiserId, metricType, entityId: entityId || undefined, dateRange },
    });

    if (cache) {
      cache.metricData = metrics as any;
      cache.expiresAt = expiresAt;
    } else {
      cache = this.metricsCacheRepository.create({
        advertiserId,
        metricType,
        entityId: entityId || undefined,
        dateRange,
        metricData: metrics as any,
        expiresAt,
      });
    }

    await this.metricsCacheRepository.save(cache);
  }

  // ==================== UTILITIES ====================

  private async makeApiCall<T>(
    url: string,
    accessToken: string,
    params?: Record<string, any>,
    method: 'GET' | 'POST' = 'GET',
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Access-Token': accessToken,
      'Content-Type': 'application/json',
    };

    const options: RequestInit = {
      method,
      headers,
    };

    let finalUrl = url;
    if (method === 'GET' && params) {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });
      finalUrl = `${url}?${searchParams.toString()}`;
    } else if (params) {
      options.body = JSON.stringify(params);
    }

    const response = await fetch(finalUrl, options);
    return response.json();
  }

  private transformMetrics(raw: any): PlatformMetrics {
    if (!raw) {
      return {
        impressions: 0,
        clicks: 0,
        spend: 0,
        cpc: 0,
        cpm: 0,
        ctr: 0,
      };
    }

    return {
      impressions: parseFloat(raw.impressions) || 0,
      clicks: parseFloat(raw.clicks) || 0,
      spend: parseFloat(raw.spend) || 0,
      reach: parseFloat(raw.reach) || 0,
      frequency: parseFloat(raw.frequency) || 0,
      cpc: parseFloat(raw.cpc) || 0,
      cpm: parseFloat(raw.cpm) || 0,
      ctr: parseFloat(raw.ctr) || 0,
      conversions: parseFloat(raw.conversion) || 0,
      costPerConversion: parseFloat(raw.cost_per_conversion) || 0,
      roas: raw.total_purchase_value && raw.spend 
        ? parseFloat(raw.total_purchase_value) / parseFloat(raw.spend) 
        : undefined,
    };
  }
}
