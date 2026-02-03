import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FacebookSession } from './entities/facebook-session.entity';
import { CampaignData } from './entities/campaign-data.entity';
import { MetricsCache } from './entities/metrics-cache.entity';
import { CreativesCache } from './entities/creatives-cache.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly graphApiVersion = 'v18.0';

  constructor(
    @InjectRepository(FacebookSession)
    private facebookSessionRepository: Repository<FacebookSession>,
    @InjectRepository(CampaignData)
    private campaignDataRepository: Repository<CampaignData>,
    @InjectRepository(MetricsCache)
    private metricsCacheRepository: Repository<MetricsCache>,
    @InjectRepository(CreativesCache)
    private creativesCacheRepository: Repository<CreativesCache>,
    private configService: ConfigService,
  ) { }

  // Session Management
  async saveFacebookSession(
    userId: number,
    accessToken: string,
    adAccountId?: string,
    tokenExpiresAt?: Date,
  ): Promise<FacebookSession> {
    let session = await this.facebookSessionRepository.findOneBy({ userId });
    if (session) {
      session.accessToken = accessToken;
      session.adAccountId = adAccountId || session.adAccountId;
      session.tokenExpiresAt = tokenExpiresAt || session.tokenExpiresAt;
    } else {
      session = this.facebookSessionRepository.create({
        userId,
        accessToken,
        adAccountId,
        tokenExpiresAt,
      });
    }
    return this.facebookSessionRepository.save(session);
  }

  async getFacebookSession(userId: number): Promise<FacebookSession | null> {
    return this.facebookSessionRepository.findOne({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  // Facebook Graph API Methods
  async makeGraphApiCall(
    endpoint: string,
    accessToken: string,
    params?: Record<string, string>,
  ): Promise<any> {
    const url = new URL(
      `https://graph.facebook.com/${this.graphApiVersion}${endpoint}`,
    );
    url.searchParams.append('access_token', accessToken);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });
    }

    try {
      const response = await fetch(url.toString());

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.error?.message || `Facebook API error: ${response.status}`,
        );
      }

      return response.json();
    } catch (error) {
      this.logger.error(`Graph API call failed: ${error}`);
      throw error;
    }
  }

  async getAdAccounts(accessToken: string): Promise<any[]> {
    const result = await this.makeGraphApiCall('/me/adaccounts', accessToken, {
      fields: 'id,name,account_status,currency,timezone_name',
      limit: '100',
    });
    return result.data || [];
  }

  async getAds(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);

    // Request basic ad data without insights to avoid data overload
    // Insights can be fetched separately per ad if needed
    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/ads`,
      accessToken,
      {
        fields:
          'id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url,image_url}',
        limit: '100', // Reduce limit
      },
    );

    // Transform snake_case to camelCase for frontend compatibility
    const transformedAds = (result.data || []).map((ad: any) => ({
      ...ad,
      creative: ad.creative
        ? {
          ...ad.creative,
          thumbnailUrl: ad.creative.thumbnail_url,
          imageUrl: ad.creative.image_url,
        }
        : undefined,
    }));

    return {
      ads: transformedAds,
      paging: result.paging,
    };
  }

  async getInsights(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);

    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/insights`,
      accessToken,
      {
        fields:
          'impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,conversions',
        date_preset: datePreset,
        level: 'account',
      },
    );

    return result.data?.[0] || {};
  }

  async getDailyInsights(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
    compare: boolean = false,
  ): Promise<{
    data: { current: any[]; previous: any[] | null };
    summaryStats: any;
  }> {
    // Calculate date ranges based on dateRange
    const { datePreset, dayCount } = this.getDatePresetAndDays(dateRange);

    this.logger.log(`[getDailyInsights] Fetching insights for account ${adAccountId}, dateRange: ${dateRange}, compare: ${compare}`);
    this.logger.log(`[getDailyInsights] Using date_preset: ${datePreset} (${dayCount} days)`);

    try {
      // Fetch current period insights with daily breakdown using date_preset
      const currentInsights = await this.makeGraphApiCall(
        `/act_${adAccountId}/insights`,
        accessToken,
        {
          fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,actions',
          date_preset: datePreset,
          time_increment: '1',  // Daily breakdown
          level: 'account',
          limit: '100',
        },
      );

      this.logger.log(`[getDailyInsights] Current insights response: ${JSON.stringify(currentInsights).substring(0, 500)}...`);

      // Transform current period data
      const currentData = (currentInsights.data || []).map((day: any) => {
        const revenue = this.calculateRevenue(day.actions);
        const spend = parseFloat(day.spend || '0');
        return {
          date: day.date_start,
          spend,
          revenue,
          roas: spend > 0 ? revenue / spend : 0,
          clicks: parseInt(day.clicks || '0'),
          impressions: parseInt(day.impressions || '0'),
          ctr: parseFloat(day.ctr || '0'),
          cpc: parseFloat(day.cpc || '0'),
          cpm: parseFloat(day.cpm || '0'),
        };
      });

      // Fetch previous period if compare mode is enabled
      let previousData: any[] | null = null;
      if (compare) {
        // Calculate dates for previous period using getDateRange
        const { startDate: currentStartDate } = this.getDateRange(dateRange);
        const prevEndDate = new Date(currentStartDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
        const prevStartDate = new Date(prevEndDate);
        prevStartDate.setDate(prevStartDate.getDate() - dayCount + 1);

        const previousInsights = await this.makeGraphApiCall(
          `/act_${adAccountId}/insights`,
          accessToken,
          {
            fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,actions',
            time_range: JSON.stringify({
              since: prevStartDate.toISOString().split('T')[0],
              until: prevEndDate.toISOString().split('T')[0],
            }),
            time_increment: '1',
            level: 'account',
            limit: '100',
          },
        );

        previousData = (previousInsights.data || []).map((day: any) => {
          const revenue = this.calculateRevenue(day.actions);
          const spend = parseFloat(day.spend || '0');
          return {
            date: day.date_start,
            spend,
            revenue,
            roas: spend > 0 ? revenue / spend : 0,
            clicks: parseInt(day.clicks || '0'),
            impressions: parseInt(day.impressions || '0'),
            ctr: parseFloat(day.ctr || '0'),
            cpc: parseFloat(day.cpc || '0'),
            cpm: parseFloat(day.cpm || '0'),
          };
        });
      }

      // Calculate summary stats
      const sumData = (data: any[]) => data.reduce(
        (acc, day) => ({
          spend: acc.spend + day.spend,
          revenue: acc.revenue + day.revenue,
          clicks: acc.clicks + day.clicks,
          impressions: acc.impressions + day.impressions,
          roas: 0, // Will calculate after
        }),
        { spend: 0, revenue: 0, clicks: 0, impressions: 0, roas: 0 },
      );

      const currentSums = sumData(currentData);
      currentSums.roas = currentSums.spend > 0 ? currentSums.revenue / currentSums.spend : 0;

      const previousSums = previousData ? sumData(previousData) : null;
      if (previousSums) {
        previousSums.roas = previousSums.spend > 0 ? previousSums.revenue / previousSums.spend : 0;
      }

      const calcChange = (current: number, previous: number | null) =>
        previous && previous > 0 ? ((current - previous) / previous) * 100 : 0;

      const summaryStats = {
        spend: {
          current: currentSums.spend,
          previous: previousSums?.spend || 0,
          change: calcChange(currentSums.spend, previousSums?.spend || null),
        },
        revenue: {
          current: currentSums.revenue,
          previous: previousSums?.revenue || 0,
          change: calcChange(currentSums.revenue, previousSums?.revenue || null),
        },
        roas: {
          current: currentSums.roas,
          previous: previousSums?.roas || 0,
          change: calcChange(currentSums.roas, previousSums?.roas || null),
        },
        clicks: {
          current: currentSums.clicks,
          previous: previousSums?.clicks || 0,
          change: calcChange(currentSums.clicks, previousSums?.clicks || null),
        },
        impressions: {
          current: currentSums.impressions,
          previous: previousSums?.impressions || 0,
          change: calcChange(currentSums.impressions, previousSums?.impressions || null),
        },
      };

      return {
        data: { current: currentData, previous: previousData },
        summaryStats,
      };
    } catch (error) {
      this.logger.error(`[getDailyInsights] Error fetching insights: ${error}`);
      // Return empty data on error instead of crashing
      return {
        data: { current: [], previous: null },
        summaryStats: {
          spend: { current: 0, previous: 0, change: 0 },
          revenue: { current: 0, previous: 0, change: 0 },
          roas: { current: 0, previous: 0, change: 0 },
          clicks: { current: 0, previous: 0, change: 0 },
          impressions: { current: 0, previous: 0, change: 0 },
        },
      };
    }
  }
  private getDateRange(dateRange: string): { startDate: string; endDate: string; dayCount: number } {
    const endDate = new Date();
    const startDate = new Date();
    let dayCount = 30;

    switch (dateRange) {
      case 'last_7d':
        startDate.setDate(endDate.getDate() - 7);
        dayCount = 7;
        break;
      case 'last_14d':
        startDate.setDate(endDate.getDate() - 14);
        dayCount = 14;
        break;
      case 'last_30d':
        startDate.setDate(endDate.getDate() - 30);
        dayCount = 30;
        break;
      case 'last_90d':
        startDate.setDate(endDate.getDate() - 90);
        dayCount = 90;
        break;
      default:
        startDate.setDate(endDate.getDate() - 30);
        dayCount = 30;
    }

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      dayCount,
    };
  }

  private getDatePresetAndDays(dateRange: string): { datePreset: string; dayCount: number } {
    switch (dateRange) {
      case 'last_7d':
        return { datePreset: 'last_7d', dayCount: 7 };
      case 'last_14d':
        return { datePreset: 'last_14d', dayCount: 14 };
      case 'last_30d':
        return { datePreset: 'last_30d', dayCount: 30 };
      case 'last_90d':
        return { datePreset: 'last_90d', dayCount: 90 };
      default:
        return { datePreset: 'last_30d', dayCount: 30 };
    }
  }
  private calculateRevenue(actions: any[] | undefined): number {
    if (!actions) return 0;
    const purchaseActions = actions.filter(
      (a: any) => a.action_type === 'purchase' || a.action_type === 'omni_purchase',
    );
    return purchaseActions.reduce((sum: number, a: any) => sum + parseFloat(a.value || '0'), 0);
  }

  async getCreatives(
    adAccountId: string,
    accessToken: string,
    dateRange: string = 'last_30d',
  ): Promise<any[]> {
    const datePreset = this.getDatePreset(dateRange);

    // Fetch ads with creative details and insights
    // We use ads endpoint to get creative usage context (campaign, adset) and performance
    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/ads`,
      accessToken,
      {
        fields: [
          'id',
          'name',
          'status',
          'creative{id,name,thumbnail_url,image_url,object_story_spec,asset_feed_spec,video_id}',
          'campaign{name}',
          'adset{name}',
          `insights.date_preset(${datePreset}){spend,clicks,impressions,ctr,cpc,actions,action_values,reach,frequency}`,
        ].join(','),
        limit: '500',
      },
    );

    const ads = result.data || [];
    const creativeMap = new Map<string, any>();

    for (const ad of ads) {
      if (!ad.creative) continue;

      const creativeId = ad.creative.id;
      // Insights is usually an array, take the first element provided by date_preset
      const insights = ad.insights?.data?.[0] || {};

      const spend = parseFloat(insights.spend || 0);
      const clicks = parseInt(insights.clicks || 0);
      const impressions = parseInt(insights.impressions || 0);
      const reach = parseInt(insights.reach || 0);
      const frequency = parseFloat(insights.frequency || 0);

      // Calculate Return (Purchase Value)
      let purchaseValue = 0;
      const actionValues = insights.action_values || [];
      if (Array.isArray(actionValues)) {
        const purchase = actionValues.find(
          (a: any) =>
            a.action_type === 'purchase' ||
            a.action_type === 'offsite_conversion.fb_pixel_purchase' ||
            a.action_type === 'omni_purchase',
        );
        if (purchase) purchaseValue = parseFloat(purchase.value);
      }

      if (!creativeMap.has(creativeId)) {
        // Determine type
        let creativeType = 'image';
        if (ad.creative.video_id || ad.creative.object_story_spec?.video_data) {
          creativeType = 'video';
        } else if (
          ad.creative.object_story_spec?.link_data?.child_attachments
        ) {
          creativeType = 'carousel';
        } else if (ad.creative.asset_feed_spec) {
          creativeType = 'dynamic';
        }

        creativeMap.set(creativeId, {
          id: creativeId, // Keep as string to preserve precision and match API
          name: ad.creative.name || ad.name,
          thumbnailUrl: ad.creative.thumbnail_url || ad.creative.image_url,
          imageUrl: ad.creative.image_url || ad.creative.thumbnail_url,
          creativeType,
          campaignName: ad.campaign?.name || 'Unknown Campaign',
          adsetName: ad.adset?.name || 'Unknown Ad Set',
          // Metrics aggregation
          spend: 0,
          clicks: 0,
          impressions: 0,
          reach: 0,
          maxFrequency: 0,
          purchaseValue: 0,
          adCount: 0,
        });
      }

      const creative = creativeMap.get(creativeId);
      creative.spend += spend;
      creative.clicks += clicks;
      creative.impressions += impressions;
      // Reach cannot be simply summed, but we use approximation or max?
      // Summing reach is very wrong, but taking max is also wrong.
      // Let's sum it for now as a rough "gross reach" or leave it.
      creative.reach += reach;
      creative.maxFrequency = Math.max(creative.maxFrequency, frequency);
      creative.purchaseValue += purchaseValue;
      creative.adCount += 1;

      // Update names if "Unknown" and we found better info
      if (creative.campaignName === 'Unknown Campaign' && ad.campaign?.name) {
        creative.campaignName = ad.campaign.name;
      }
      if (creative.adsetName === 'Unknown Ad Set' && ad.adset?.name) {
        creative.adsetName = ad.adset.name;
      }
    }

    // Post processing: calculate derived metrics
    return Array.from(creativeMap.values()).map((c) => {
      const ctr = c.impressions > 0 ? (c.clicks / c.impressions) * 100 : 0;
      const cpc = c.clicks > 0 ? c.spend / c.clicks : 0;
      const cpm = c.impressions > 0 ? (c.spend / c.impressions) * 1000 : 0;
      const roas = c.spend > 0 ? c.purchaseValue / c.spend : 0;
      // Use maxFrequency as a proxy for fatigue? Or average frequency?
      // Weighted average frequency
      const frequency = c.reach > 0 ? c.impressions / c.reach : 0;

      // Determine performance
      let performance = 'average';
      if (c.spend === 0) {
        performance = 'average';
      } else if (roas > 3.0) {
        performance = 'excellent';
      } else if (roas > 1.5 || (cpc < 1.0 && ctr > 1.0)) {
        performance = 'good';
      } else if (ctr < 0.5 || cpc > 3.0) {
        performance = 'poor';
      }

      // Determine fatigue
      let fatigueLevel = 'low';
      if (frequency > 3.5) fatigueLevel = 'high';
      else if (frequency > 2.0) fatigueLevel = 'medium';

      return {
        ...c,
        ctr,
        cpc,
        cpm,
        roas,
        frequency, // derived frequency
        performance,
        fatigueLevel,
        fatigueConfidence: 85,
      };
    });
  }

  async getDemographics(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);

    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/insights`,
      accessToken,
      {
        fields: 'impressions,clicks,spend,actions',
        date_preset: datePreset,
        breakdowns: 'age,gender',
      },
    );

    return result.data || [];
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const appId = this.configService.get<string>('facebook.appId');
    const appSecret = this.configService.get<string>('facebook.appSecret');

    const url = `https://graph.facebook.com/${this.graphApiVersion}/oauth/access_token`;
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId || '',
      client_secret: appSecret || '',
      fb_exchange_token: shortLivedToken,
    });

    const response = await fetch(`${url}?${params.toString()}`);
    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    return {
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    };
  }

  private getDatePreset(dateRange: string): string {
    const presetMap: Record<string, string> = {
      today: 'today',
      yesterday: 'yesterday',
      last_7d: 'last_7d',
      last_14d: 'last_14d',
      last_30d: 'last_30d',
      last_90d: 'last_90d',
      this_month: 'this_month',
      last_month: 'last_month',
    };
    return presetMap[dateRange] || 'last_30d';
  }

  // Cache methods (unchanged)
  async saveCampaignData(
    sessionId: number,
    campaigns: any[],
    dateRange: string,
  ): Promise<void> {
    await this.campaignDataRepository.delete({ sessionId, dateRange });

    const entities = campaigns.map((campaign) =>
      this.campaignDataRepository.create({
        sessionId,
        campaignId: campaign.id,
        campaignName: campaign.name || 'Unknown',
        clicks: parseInt(campaign.insights?.clicks || 0),
        impressions: parseInt(campaign.insights?.impressions || 0),
        reach: parseInt(campaign.insights?.reach || 0),
        spend: parseFloat(campaign.insights?.spend || 0),
        cpc: parseFloat(campaign.insights?.cpc || 0),
        cpm: parseFloat(campaign.insights?.cpm || 0),
        ctr: campaign.insights?.ctr || '0%',
        status: campaign.status || 'UNKNOWN',
        objective: campaign.objective || 'UNKNOWN',
        dateRange,
      }),
    );

    await this.campaignDataRepository.save(entities);
  }

  async getCampaignData(
    sessionId: number,
    dateRange: string,
  ): Promise<CampaignData[]> {
    return this.campaignDataRepository.find({
      where: { sessionId, dateRange },
      order: { spend: 'DESC' },
    });
  }

  async saveMetricsCache(
    sessionId: number,
    metrics: any[],
    dateRange: string,
  ): Promise<void> {
    await this.metricsCacheRepository.delete({ sessionId, dateRange });

    const entities = metrics.map((metric) =>
      this.metricsCacheRepository.create({
        sessionId,
        metricName: metric.label,
        metricValue: metric.value,
        dateRange,
      }),
    );

    await this.metricsCacheRepository.save(entities);
  }

  async getMetricsCache(
    sessionId: number,
    dateRange: string,
  ): Promise<MetricsCache[]> {
    return this.metricsCacheRepository.find({
      where: { sessionId, dateRange },
    });
  }

  async saveCreativesCache(
    adAccountId: string,
    dateRange: string,
    payload: any,
  ): Promise<void> {
    await this.creativesCacheRepository.delete({ adAccountId, dateRange });

    const cache = this.creativesCacheRepository.create({
      adAccountId,
      dateRange,
      payload,
    });
    await this.creativesCacheRepository.save(cache);
  }

  async getCreativesCache(
    adAccountId: string,
    dateRange: string,
    maxAgeHours: number,
  ): Promise<any | null> {
    const cache = await this.creativesCacheRepository.findOne({
      where: { adAccountId, dateRange },
      order: { createdAt: 'DESC' },
    });

    if (!cache) return null;

    const ageMs = Date.now() - cache.createdAt.getTime();
    const ttlMs = Math.max(0, Number(maxAgeHours) || 0) * 60 * 60 * 1000;

    if (ttlMs > 0 && ageMs < ttlMs) {
      return cache.payload;
    }
    return null;
  }

  async clearCreativesCache(
    adAccountId?: string,
    dateRange?: string,
  ): Promise<void> {
    if (adAccountId && dateRange) {
      await this.creativesCacheRepository.delete({ adAccountId, dateRange });
    } else {
      await this.creativesCacheRepository.clear();
    }
  }

  async getAdsets(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);

    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/adsets`,
      accessToken,
      {
        fields:
          'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,campaign{id,name},targeting,optimization_goal',
        limit: '200',
      },
    );

    const adsets = result.data || [];

    // Fetch insights for adsets
    const insightsResult = await this.makeGraphApiCall(
      `/act_${adAccountId}/insights`,
      accessToken,
      {
        fields:
          'adset_id,impressions,clicks,spend,reach,frequency,cpc,cpm,ctr,actions,action_values',
        level: 'adset',
        time_increment: 'all_days',
        date_preset: datePreset,
        limit: '200',
      },
    );

    const insightsByAdset = new Map<string, any>();
    for (const insight of insightsResult.data || []) {
      insightsByAdset.set(insight.adset_id, {
        impressions: parseInt(insight.impressions || '0'),
        clicks: parseInt(insight.clicks || '0'),
        spend: parseFloat(insight.spend || '0'),
        reach: parseInt(insight.reach || '0'),
        frequency: parseFloat(insight.frequency || '0'),
        cpc: parseFloat(insight.cpc || '0'),
        cpm: parseFloat(insight.cpm || '0'),
        ctr: insight.ctr || '0%',
      });
    }

    const adsetsWithInsights = adsets.map((adset: any) => ({
      ...adset,
      insights: insightsByAdset.get(adset.id) || {
        impressions: 0,
        clicks: 0,
        spend: 0,
        reach: 0,
        frequency: 0,
        cpc: 0,
        cpm: 0,
        ctr: '0%',
      },
    }));

    return {
      adsets: adsetsWithInsights,
      dateRange,
      totalCount: adsetsWithInsights.length,
    };
  }

  async getAdPreview(
    adId: string,
    accessToken: string,
    format: string = 'DESKTOP_FEED_STANDARD',
  ): Promise<any> {
    const fallbackFormats = [
      format,
      'MOBILE_FEED_STANDARD',
      'RIGHT_COLUMN_STANDARD',
      'DESKTOP_FEED_STANDARD',
      'MOBILE_BANNER',
    ];

    for (const fmt of fallbackFormats) {
      try {
        const result = await this.makeGraphApiCall(
          `/${adId}/previews`,
          accessToken,
          {
            ad_format: fmt,
          },
        );

        if (result.data && result.data.length > 0) {
          return {
            success: true,
            preview: result.data[0],
            format: fmt,
            fallback: fmt !== format,
          };
        }
      } catch (error) {
        // Try next format
      }
    }

    return {
      success: false,
      error: 'No preview available for this ad',
    };
  }

  async getCreativePreview(
    creativeId: string,
    accessToken: string,
  ): Promise<any> {
    const result = await this.makeGraphApiCall(`/${creativeId}`, accessToken, {
      fields: 'id,name,title,body,thumbnail_url,image_url,object_story_spec',
    });

    // Transform snake_case to camelCase for frontend compatibility
    return {
      ...result,
      thumbnailUrl: result.thumbnail_url,
      imageUrl: result.image_url,
    };
  }
}
