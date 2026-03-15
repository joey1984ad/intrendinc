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
  private readonly graphApiVersion = 'v23.0';
  private readonly inFlightRequests = new Map<string, Promise<any>>();
  private readonly adAccountCooldownUntil = new Map<string, number>();
  private readonly permissionDeniedUntil = new Map<string, number>();
  private readonly videoSourceCache = new Map<string, { source: string; expiresAt: number }>();

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
    const requestUrl = url.toString();
    const adAccountId = this.extractAdAccountIdFromEndpoint(endpoint);
    const now = Date.now();

    if (adAccountId) {
      const permissionBlockedUntil = this.permissionDeniedUntil.get(adAccountId) || 0;
      if (permissionBlockedUntil > now) {
        throw new Error(
          'Facebook permissions missing: ad account owner must grant ads_read and ads_management.',
        );
      }

      const cooldownUntil = this.adAccountCooldownUntil.get(adAccountId) || 0;
      if (cooldownUntil > now) {
        throw new Error('User request limit reached');
      }
    }

    const existingRequest = this.inFlightRequests.get(requestUrl);
    if (existingRequest) {
      return existingRequest;
    }

    try {
      const requestPromise = (async () => {
        const response = await fetch(requestUrl);

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          const errorMessage =
            error.error?.message || `Facebook API error: ${response.status}`;

          if (adAccountId) {
            if (this.isPermissionErrorMessage(errorMessage)) {
              this.permissionDeniedUntil.set(adAccountId, now + 10 * 60 * 1000);
            } else if (this.isUserRateLimitError(errorMessage)) {
              this.adAccountCooldownUntil.set(adAccountId, now + 30 * 1000);
            }
          }

          throw new Error(errorMessage);
        }

        return response.json();
      })();

      this.inFlightRequests.set(requestUrl, requestPromise);
      return await requestPromise;
    } catch (error) {
      this.logger.error(`Graph API call failed: ${error}`);
      throw error;
    } finally {
      this.inFlightRequests.delete(requestUrl);
    }
  }

  private extractAdAccountIdFromEndpoint(endpoint: string): string | null {
    const match = endpoint.match(/\/act_(\d+)\//);
    return match?.[1] || null;
  }

  private isPermissionErrorMessage(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('(#200)') ||
      normalized.includes('ads_management') ||
      normalized.includes('ads_read')
    );
  }

  private isUserRateLimitError(message: string): boolean {
    const normalized = String(message || '').toLowerCase();
    return (
      normalized.includes('user request limit reached') ||
      normalized.includes('application request limit reached') ||
      normalized.includes('too many calls') ||
      normalized.includes('rate limit')
    );
  }

  private isReduceDataError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes(
        "Please reduce the amount of data you're asking for, then retry your request",
      ) ||
      message.toLowerCase().includes('reduce the amount of data')
    );
  }

  private async makeGraphApiCallWithAdaptiveLimit(
    endpoint: string,
    accessToken: string,
    baseParams: Record<string, string>,
    fallbackLimits: number[],
  ): Promise<any> {
    const requestedLimit = Number.parseInt(baseParams.limit || '', 10);
    const adaptiveLimits = [
      ...(Number.isFinite(requestedLimit) ? [requestedLimit] : []),
      ...fallbackLimits,
    ].filter((value, index, list) => Number.isFinite(value) && value > 0 && list.indexOf(value) === index);

    let lastError: unknown = null;

    for (const limit of adaptiveLimits) {
      try {
        return await this.makeGraphApiCall(endpoint, accessToken, {
          ...baseParams,
          limit: String(limit),
        });
      } catch (error) {
        lastError = error;
        if (!this.isReduceDataError(error)) {
          throw error;
        }
        this.logger.warn(
          `[FacebookService] Query too large for ${endpoint}; retrying with lower limit (${limit}).`,
        );
      }
    }

    throw lastError || new Error(`Failed adaptive Graph API call for ${endpoint}`);
  }

  async getAdAccounts(accessToken: string): Promise<any[]> {
    const result = await this.makeGraphApiCall('/me/adaccounts', accessToken, {
      fields: 'id,name,account_status,currency,timezone_name',
      limit: '50',
    });
    return result.data || [];
  }

  async getAds(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const dateParams = this.getDateParams(dateRange);

    const adsResult = await this.makeGraphApiCallWithAdaptiveLimit(
      `/act_${adAccountId}/ads`,
      accessToken,
      {
        fields:
          'id,name,status,adset_id,campaign_id,creative{id,name,thumbnail_url,image_url,object_story_spec,asset_feed_spec}',
        limit: '100',
      },
      [80, 60, 40, 25],
    ).catch((error) => {
      this.logger.warn(
        `[FacebookService] Unable to fetch ads list for ${adAccountId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { data: [], paging: null };
    });

    const [
      accountResult,
      adInsightsResult,
      campaignResult,
      campaignInsightsResult,
      dailyInsightsResult,
      platformInsightsResult,
    ] = await Promise.all([
      this.makeGraphApiCall(`/act_${adAccountId}`, accessToken, {
        fields: 'id,name,account_status,currency,timezone_name',
      }).catch(() => null),
      this.makeGraphApiCallWithAdaptiveLimit(`/act_${adAccountId}/insights`, accessToken, {
        fields:
          'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
        level: 'ad',
        time_increment: 'all_days',
        limit: '250',
        ...dateParams,
      }, [200, 150, 100, 75, 50]).catch(() => ({ data: [] })),
      this.makeGraphApiCallWithAdaptiveLimit(`/act_${adAccountId}/campaigns`, accessToken, {
        fields: 'id,name,status,objective',
        limit: '120',
      }, [100, 80, 60, 40]).catch(() => ({ data: [] })),
      this.makeGraphApiCallWithAdaptiveLimit(`/act_${adAccountId}/insights`, accessToken, {
        fields:
          'campaign_id,campaign_name,impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
        level: 'campaign',
        time_increment: 'all_days',
        limit: '120',
        ...dateParams,
      }, [100, 80, 60, 40]).catch(() => ({ data: [] })),
      this.makeGraphApiCallWithAdaptiveLimit(`/act_${adAccountId}/insights`, accessToken, {
        fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
        level: 'account',
        time_increment: '1',
        limit: '180',
        ...dateParams,
      }, [140, 100, 70, 40]).catch(() => ({ data: [] })),
      this.makeGraphApiCallWithAdaptiveLimit(`/act_${adAccountId}/insights`, accessToken, {
        fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
        level: 'account',
        breakdowns: 'publisher_platform',
        time_increment: 'all_days',
        limit: '60',
        ...dateParams,
      }, [50, 40, 30, 20]).catch(() => ({ data: [] })),
    ]);

    const adInsightsById = new Map<string, any>();
    for (const insight of adInsightsResult.data || []) {
      const adId = String(insight.ad_id || '');
      if (!adId) continue;

      const metrics = this.extractMetrics(insight);
      adInsightsById.set(adId, {
        ...metrics,
        adset_name: insight.adset_name || 'Unknown Ad Set',
        campaign_name: insight.campaign_name || 'Unknown Campaign',
      });
    }

    const transformedAds = (adsResult.data || []).map((ad: any) => {
      const adId = String(ad.id || '');
      const insight = adInsightsById.get(adId) || this.getZeroMetrics();

      return {
        ...ad,
        adset_name: insight.adset_name || 'Unknown Ad Set',
        campaign_name: insight.campaign_name || 'Unknown Campaign',
        insights: {
          spend: insight.spend,
          clicks: insight.clicks,
          impressions: insight.impressions,
          reach: insight.reach,
          ctr: insight.ctr,
          cpc: insight.cpc,
          cpm: insight.cpm,
          revenue: insight.revenue,
          conversions: insight.conversions,
          roas: insight.roas,
        },
        creative: ad.creative
          ? {
              ...ad.creative,
              thumbnailUrl: ad.creative.thumbnail_url || ad.creative.image_url,
              imageUrl: ad.creative.object_story_spec?.link_data?.picture ||
                ad.creative.object_story_spec?.video_data?.image_url ||
                ad.creative.object_story_spec?.photo_data?.url ||
                ad.creative.object_story_spec?.link_data?.child_attachments?.[0]?.picture ||
                ad.creative.asset_feed_spec?.images?.[0]?.url ||
                ad.creative.image_url ||
                ad.creative.thumbnail_url ||
                null,
              videoUrl: ad.creative.object_story_spec?.video_data?.video_url ||
                ad.creative.asset_feed_spec?.videos?.[0]?.url ||
                null,
            }
          : undefined,
      };
    });

    const campaignMetaById = new Map<string, any>();
    for (const campaign of campaignResult.data || []) {
      campaignMetaById.set(String(campaign.id), campaign);
    }

    const campaignInsightsById = new Map<string, any>();
    for (const insight of campaignInsightsResult.data || []) {
      const campaignId = String(insight.campaign_id || '');
      if (!campaignId) continue;

      const metrics = this.extractMetrics(insight);
      const existing = campaignInsightsById.get(campaignId);

      if (!existing) {
        campaignInsightsById.set(campaignId, {
          id: campaignId,
          name: insight.campaign_name || `Campaign ${campaignId}`,
          ...metrics,
        });
      } else {
        existing.clicks += metrics.clicks;
        existing.impressions += metrics.impressions;
        existing.reach += metrics.reach;
        existing.spend += metrics.spend;
        existing.revenue += metrics.revenue;
        existing.conversions += metrics.conversions;
        existing.ctr =
          existing.impressions > 0
            ? (existing.clicks / existing.impressions) * 100
            : 0;
        existing.cpc =
          existing.clicks > 0 ? existing.spend / existing.clicks : 0;
        existing.cpm =
          existing.impressions > 0
            ? (existing.spend / existing.impressions) * 1000
            : 0;
        existing.roas =
          existing.spend > 0 ? existing.revenue / existing.spend : 0;
      }
    }

    const campaigns = Array.from(campaignMetaById.values()).map(
      (campaignMeta: any) => {
        const id = String(campaignMeta.id);
        const insight = campaignInsightsById.get(id) || {
          id,
          name: campaignMeta.name || `Campaign ${id}`,
          ...this.getZeroMetrics(),
        };

        return {
          id,
          name: campaignMeta.name || insight.name,
          status: campaignMeta.status || 'UNKNOWN',
          objective: campaignMeta.objective || 'UNKNOWN',
          insights: {
            clicks: insight.clicks,
            impressions: insight.impressions,
            reach: insight.reach,
            spend: insight.spend,
            cpc: insight.cpc,
            cpm: insight.cpm,
            ctr: insight.ctr,
            revenue: insight.revenue,
            conversions: insight.conversions,
            roas: insight.roas,
          },
        };
      },
    );

    for (const [campaignId, insight] of campaignInsightsById.entries()) {
      if (campaignMetaById.has(campaignId)) continue;
      campaigns.push({
        id: campaignId,
        name: insight.name || `Campaign ${campaignId}`,
        status: 'UNKNOWN',
        objective: 'UNKNOWN',
        insights: {
          clicks: insight.clicks,
          impressions: insight.impressions,
          reach: insight.reach,
          spend: insight.spend,
          cpc: insight.cpc,
          cpm: insight.cpm,
          ctr: insight.ctr,
          revenue: insight.revenue,
          conversions: insight.conversions,
          roas: insight.roas,
        },
      });
    }

    campaigns.sort(
      (a, b) => (b.insights?.spend || 0) - (a.insights?.spend || 0),
    );

    const insights = (dailyInsightsResult.data || [])
      .map((day: any) => {
        const metrics = this.extractMetrics(day);
        return {
          date_start: day.date_start,
          date_stop: day.date_stop,
          clicks: metrics.clicks,
          impressions: metrics.impressions,
          reach: metrics.reach,
          spend: metrics.spend,
          cpc: metrics.cpc,
          cpm: metrics.cpm,
          ctr: metrics.ctr,
          revenue: metrics.revenue,
          conversions: metrics.conversions,
          roas: metrics.roas,
        };
      })
      .sort(
        (a: any, b: any) =>
          new Date(a.date_start).getTime() - new Date(b.date_start).getTime(),
      );

    const accountTotals = insights.reduce(
      (acc: any, row: any) => {
        acc.totalClicks += row.clicks || 0;
        acc.totalImpressions += row.impressions || 0;
        acc.totalReach += row.reach || 0;
        acc.totalSpent += row.spend || 0;
        acc.totalRevenue += row.revenue || 0;
        acc.totalConversions += row.conversions || 0;
        return acc;
      },
      {
        totalRevenue: 0,
        totalSpent: 0,
        avgROAS: 0,
        totalClicks: 0,
        totalImpressions: 0,
        totalReach: 0,
        avgCPC: 0,
        avgCPM: 0,
        avgCTR: 0,
        totalConversions: 0,
      },
    );

    accountTotals.avgCPC =
      accountTotals.totalClicks > 0
        ? accountTotals.totalSpent / accountTotals.totalClicks
        : 0;
    accountTotals.avgCPM =
      accountTotals.totalImpressions > 0
        ? (accountTotals.totalSpent / accountTotals.totalImpressions) * 1000
        : 0;
    accountTotals.avgCTR =
      accountTotals.totalImpressions > 0
        ? (accountTotals.totalClicks / accountTotals.totalImpressions) * 100
        : 0;
    accountTotals.avgROAS =
      accountTotals.totalSpent > 0
        ? accountTotals.totalRevenue / accountTotals.totalSpent
        : 0;

    // Fallback: if daily insights are unavailable, derive totals from campaign aggregates.
    if (insights.length === 0 && campaigns.length > 0) {
      const campaignTotals = campaigns.reduce(
        (acc: any, campaign: any) => {
          const campaignInsights = campaign?.insights || {};
          acc.totalClicks += this.parseInteger(campaignInsights.clicks);
          acc.totalImpressions += this.parseInteger(campaignInsights.impressions);
          acc.totalReach += this.parseInteger(campaignInsights.reach);
          acc.totalSpent += this.parseNumeric(campaignInsights.spend);
          acc.totalRevenue += this.parseNumeric(campaignInsights.revenue);
          acc.totalConversions += this.parseNumeric(campaignInsights.conversions);
          return acc;
        },
        {
          totalRevenue: 0,
          totalSpent: 0,
          avgROAS: 0,
          totalClicks: 0,
          totalImpressions: 0,
          totalReach: 0,
          avgCPC: 0,
          avgCPM: 0,
          avgCTR: 0,
          totalConversions: 0,
        },
      );

      campaignTotals.avgCPC =
        campaignTotals.totalClicks > 0
          ? campaignTotals.totalSpent / campaignTotals.totalClicks
          : 0;
      campaignTotals.avgCPM =
        campaignTotals.totalImpressions > 0
          ? (campaignTotals.totalSpent / campaignTotals.totalImpressions) * 1000
          : 0;
      campaignTotals.avgCTR =
        campaignTotals.totalImpressions > 0
          ? (campaignTotals.totalClicks / campaignTotals.totalImpressions) * 100
          : 0;
      campaignTotals.avgROAS =
        campaignTotals.totalSpent > 0
          ? campaignTotals.totalRevenue / campaignTotals.totalSpent
          : 0;

      Object.assign(accountTotals, campaignTotals);
    }

    const platformStats = new Map<string, any>();
    for (const row of platformInsightsResult.data || []) {
      const key = String(row.publisher_platform || 'unknown').toLowerCase();
      const metrics = this.extractMetrics(row);
      const existing = platformStats.get(key);

      if (!existing) {
        platformStats.set(key, {
          key,
          clicks: metrics.clicks,
          impressions: metrics.impressions,
          reach: metrics.reach,
          spend: metrics.spend,
          revenue: metrics.revenue,
          conversions: metrics.conversions,
        });
      } else {
        existing.clicks += metrics.clicks;
        existing.impressions += metrics.impressions;
        existing.reach += metrics.reach;
        existing.spend += metrics.spend;
        existing.revenue += metrics.revenue;
        existing.conversions += metrics.conversions;
      }
    }

    const platformNameMap: Record<string, string> = {
      facebook: 'Facebook',
      instagram: 'Instagram',
      audience_network: 'Audience Network',
      messenger: 'Messenger',
      unknown: 'Unknown',
    };
    const platformColorMap: Record<string, string> = {
      facebook: '#1877F2',
      instagram: '#E4405F',
      audience_network: '#42A5F5',
      messenger: '#0084FF',
      unknown: '#94A3B8',
    };

    const platformBreakdown = Array.from(platformStats.values())
      .map((platform: any) => {
        const ctr =
          platform.impressions > 0
            ? (platform.clicks / platform.impressions) * 100
            : 0;
        const cpc =
          platform.clicks > 0 ? platform.spend / platform.clicks : 0;
        const cpm =
          platform.impressions > 0
            ? (platform.spend / platform.impressions) * 1000
            : 0;
        const roas =
          platform.spend > 0 ? platform.revenue / platform.spend : 0;

        return {
          name: platformNameMap[platform.key] || platform.key,
          value: platform.clicks,
          color: platformColorMap[platform.key] || '#94A3B8',
          clicks: platform.clicks,
          impressions: platform.impressions,
          reach: platform.reach,
          spend: platform.spend,
          cpc,
          cpm,
          ctr,
          revenue: platform.revenue,
          conversions: platform.conversions,
          roas,
        };
      })
      .sort((a: any, b: any) => b.value - a.value);

    return {
      accountInfo: {
        id: accountResult?.id || `act_${adAccountId}`,
        name: accountResult?.name || `Ad Account ${adAccountId}`,
        accountStatus: accountResult?.account_status,
        currency: accountResult?.currency || 'USD',
        timezoneName: accountResult?.timezone_name || 'UTC',
      },
      accountTotals,
      insights,
      campaigns,
      platformBreakdown,
      ads: transformedAds,
      paging: adsResult.paging,
      dateRange,
    };
  }

  async getInsights(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const dateParams = this.getDateParams(dateRange);

    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/insights`,
      accessToken,
      {
        fields:
          'impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,action_values,conversions',
        ...dateParams,
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
    const dateParams = this.getDateParams(dateRange);
    const { dayCount } = this.getDateRange(dateRange);
    const dateParamLog =
      dateParams.date_preset || dateParams.time_range || 'last_30d';

    this.logger.log(
      `[getDailyInsights] Fetching insights for account ${adAccountId}, dateRange: ${dateRange}, compare: ${compare}`,
    );
    this.logger.log(
      `[getDailyInsights] Using date params: ${dateParamLog} (${dayCount} days)`,
    );

    try {
      const currentInsights = await this.makeGraphApiCall(
        `/act_${adAccountId}/insights`,
        accessToken,
        {
          fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
          ...dateParams,
          time_increment: '1',
          level: 'account',
          limit: '400',
        },
      );

      this.logger.log(
        `[getDailyInsights] Current insights response: ${JSON.stringify(currentInsights).substring(0, 500)}...`,
      );

      const currentData = (currentInsights.data || []).map((day: any) => {
        const revenue = this.calculateRevenue(day.actions, day.action_values);
        const spend = this.parseNumeric(day.spend);
        return {
          date: day.date_start,
          spend,
          revenue,
          roas: spend > 0 ? revenue / spend : 0,
          clicks: this.parseInteger(day.clicks),
          impressions: this.parseInteger(day.impressions),
          ctr: this.parsePercent(day.ctr),
          cpc: this.parseNumeric(day.cpc),
          cpm: this.parseNumeric(day.cpm),
        };
      });

      let previousData: any[] | null = null;
      if (compare) {
        const { startDate: currentStartDate } = this.getDateRange(dateRange);
        const prevEndDate = new Date(currentStartDate);
        prevEndDate.setDate(prevEndDate.getDate() - 1);
        const prevStartDate = new Date(prevEndDate);
        prevStartDate.setDate(prevStartDate.getDate() - dayCount + 1);

        const previousInsights = await this.makeGraphApiCall(
          `/act_${adAccountId}/insights`,
          accessToken,
          {
            fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,actions,action_values',
            time_range: JSON.stringify({
              since: this.formatDateForApi(prevStartDate),
              until: this.formatDateForApi(prevEndDate),
            }),
            time_increment: '1',
            level: 'account',
            limit: '400',
          },
        );

        previousData = (previousInsights.data || []).map((day: any) => {
          const revenue = this.calculateRevenue(day.actions, day.action_values);
          const spend = this.parseNumeric(day.spend);
          return {
            date: day.date_start,
            spend,
            revenue,
            roas: spend > 0 ? revenue / spend : 0,
            clicks: this.parseInteger(day.clicks),
            impressions: this.parseInteger(day.impressions),
            ctr: this.parsePercent(day.ctr),
            cpc: this.parseNumeric(day.cpc),
            cpm: this.parseNumeric(day.cpm),
          };
        });
      }

      const sumData = (data: any[]) =>
        data.reduce(
          (acc, day) => ({
            spend: acc.spend + day.spend,
            revenue: acc.revenue + day.revenue,
            clicks: acc.clicks + day.clicks,
            impressions: acc.impressions + day.impressions,
            roas: 0,
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
  private getDateRange(dateRange: string): {
    startDate: string;
    endDate: string;
    dayCount: number;
  } {
    const customRange = this.parseCustomDateRange(dateRange);
    if (customRange) {
      const start = new Date(`${customRange.since}T00:00:00.000Z`);
      const end = new Date(`${customRange.until}T00:00:00.000Z`);
      const dayCount = Math.max(
        1,
        Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) +
          1,
      );
      return {
        startDate: customRange.since,
        endDate: customRange.until,
        dayCount,
      };
    }

    const endDate = new Date();
    const startDate = new Date(endDate);
    let dayCount = 30;

    switch (dateRange) {
      case 'today':
        dayCount = 1;
        break;
      case 'yesterday':
        startDate.setDate(endDate.getDate() - 1);
        endDate.setDate(endDate.getDate() - 1);
        dayCount = 1;
        break;
      case 'last_7d':
        startDate.setDate(endDate.getDate() - 6);
        dayCount = 7;
        break;
      case 'last_14d':
        startDate.setDate(endDate.getDate() - 13);
        dayCount = 14;
        break;
      case 'last_30d':
        startDate.setDate(endDate.getDate() - 29);
        dayCount = 30;
        break;
      case 'last_90d':
        startDate.setDate(endDate.getDate() - 89);
        dayCount = 90;
        break;
      case 'last_6m':
        startDate.setDate(endDate.getDate() - 179);
        dayCount = 180;
        break;
      case 'last_year':
      case 'last_12m':
        startDate.setDate(endDate.getDate() - 364);
        dayCount = 365;
        break;
      case 'this_month':
        startDate.setDate(1);
        dayCount =
          Math.floor(
            (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
          ) + 1;
        break;
      case 'last_month': {
        const firstDayCurrentMonth = new Date(
          endDate.getFullYear(),
          endDate.getMonth(),
          1,
        );
        const firstDayLastMonth = new Date(
          firstDayCurrentMonth.getFullYear(),
          firstDayCurrentMonth.getMonth() - 1,
          1,
        );
        const lastDayLastMonth = new Date(
          firstDayCurrentMonth.getFullYear(),
          firstDayCurrentMonth.getMonth(),
          0,
        );
        startDate.setTime(firstDayLastMonth.getTime());
        endDate.setTime(lastDayLastMonth.getTime());
        dayCount =
          Math.floor(
            (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
          ) + 1;
        break;
      }
      default:
        startDate.setDate(endDate.getDate() - 29);
        dayCount = 30;
    }

    return {
      startDate: this.formatDateForApi(startDate),
      endDate: this.formatDateForApi(endDate),
      dayCount,
    };
  }

  private getDateParams(dateRange: string): Record<string, string> {
    const customRange = this.parseCustomDateRange(dateRange);
    if (customRange) {
      return { time_range: JSON.stringify(customRange) };
    }

    if (
      dateRange === 'last_6m' ||
      dateRange === 'last_year' ||
      dateRange === 'last_12m'
    ) {
      const { startDate, endDate } = this.getDateRange(dateRange);
      return {
        time_range: JSON.stringify({
          since: startDate,
          until: endDate,
        }),
      };
    }

    return { date_preset: this.getDatePreset(dateRange) };
  }

  private getInsightsDateSpecifier(dateRange: string): string {
    const dateParams = this.getDateParams(dateRange);
    if (dateParams.time_range) {
      return `time_range(${dateParams.time_range})`;
    }

    return `date_preset(${dateParams.date_preset || 'last_30d'})`;
  }

  private parseCustomDateRange(
    dateRange: string,
  ): { since: string; until: string } | null {
    if (!dateRange || typeof dateRange !== 'string') {
      return null;
    }

    const trimmed = dateRange.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
      return null;
    }

    try {
      const parsed = JSON.parse(trimmed);
      const since = typeof parsed?.since === 'string' ? parsed.since : '';
      const until = typeof parsed?.until === 'string' ? parsed.until : '';
      if (!since || !until) return null;

      const sinceDate = new Date(`${since}T00:00:00.000Z`);
      const untilDate = new Date(`${until}T00:00:00.000Z`);
      if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) {
        return null;
      }

      return {
        since,
        until,
      };
    } catch {
      return null;
    }
  }

  private formatDateForApi(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private parseNumeric(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private parseInteger(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.trunc(value);
    }
    if (typeof value === 'string') {
      const parsed = parseInt(value, 10);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private parsePercent(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const cleaned = value.replace('%', '').trim();
      const parsed = parseFloat(cleaned);
      return Number.isNaN(parsed) ? 0 : parsed;
    }
    return 0;
  }

  private isPurchaseActionType(actionType: unknown): boolean {
    if (typeof actionType !== 'string') return false;
    return (
      actionType === 'purchase' ||
      actionType === 'omni_purchase' ||
      actionType === 'offsite_conversion.fb_pixel_purchase' ||
      actionType === 'offsite_conversion.purchase'
    );
  }

  private calculateRevenue(
    actions: any[] | undefined,
    actionValues: any[] | undefined = [],
  ): number {
    const valueSource = Array.isArray(actionValues) ? actionValues : [];
    const revenueFromActionValues = valueSource
      .filter((item: any) => this.isPurchaseActionType(item?.action_type))
      .reduce(
        (sum: number, item: any) => sum + this.parseNumeric(item?.value),
        0,
      );

    if (revenueFromActionValues > 0) {
      return revenueFromActionValues;
    }

    const actionSource = Array.isArray(actions) ? actions : [];
    return actionSource
      .filter((item: any) => this.isPurchaseActionType(item?.action_type))
      .reduce(
        (sum: number, item: any) => sum + this.parseNumeric(item?.value),
        0,
      );
  }

  private calculateConversions(actions: any[] | undefined): number {
    const actionSource = Array.isArray(actions) ? actions : [];
    return actionSource
      .filter((item: any) => this.isPurchaseActionType(item?.action_type))
      .reduce(
        (sum: number, item: any) => sum + this.parseNumeric(item?.value),
        0,
      );
  }

  private getZeroMetrics() {
    return {
      clicks: 0,
      impressions: 0,
      reach: 0,
      spend: 0,
      cpc: 0,
      cpm: 0,
      ctr: 0,
      revenue: 0,
      conversions: 0,
      roas: 0,
    };
  }

  private extractMetrics(insight: any) {
    const clicks = this.parseInteger(insight?.clicks);
    const impressions = this.parseInteger(insight?.impressions);
    const reach = this.parseInteger(insight?.reach);
    const spend = this.parseNumeric(insight?.spend);
    const revenue = this.calculateRevenue(insight?.actions, insight?.action_values);
    const conversions = this.calculateConversions(insight?.actions);

    const ctrRaw = this.parsePercent(insight?.ctr);
    const cpcRaw = this.parseNumeric(insight?.cpc);
    const cpmRaw = this.parseNumeric(insight?.cpm);

    const ctr = ctrRaw > 0 ? ctrRaw : impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpc = cpcRaw > 0 ? cpcRaw : clicks > 0 ? spend / clicks : 0;
    const cpm = cpmRaw > 0 ? cpmRaw : impressions > 0 ? (spend / impressions) * 1000 : 0;
    const roas = spend > 0 ? revenue / spend : 0;

    return {
      clicks,
      impressions,
      reach,
      spend,
      cpc,
      cpm,
      ctr,
      revenue,
      conversions,
      roas,
    };
  }

  async getCreatives(
    adAccountId: string,
    accessToken: string,
    dateRange: string = 'last_30d',
  ): Promise<any[]> {
    const insightsDateSpecifier = this.getInsightsDateSpecifier(dateRange);

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
          `insights.${insightsDateSpecifier}{spend,clicks,impressions,ctr,cpc,actions,action_values,reach,frequency}`,
        ].join(','),
        limit: '50',
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

        const videoId =
          ad.creative.video_id ||
          ad.creative.object_story_spec?.video_data?.video_id ||
          undefined;

        creativeMap.set(creativeId, {
          id: creativeId, // Keep as string to preserve precision and match API
          name: ad.creative.name || ad.name,
          thumbnailUrl: ad.creative.thumbnail_url || ad.creative.image_url,
          imageUrl: ad.creative.object_story_spec?.link_data?.picture ||
            ad.creative.object_story_spec?.video_data?.image_url ||
            ad.creative.object_story_spec?.photo_data?.url ||
            ad.creative.object_story_spec?.link_data?.child_attachments?.[0]?.picture ||
            ad.creative.asset_feed_spec?.images?.[0]?.url ||
            ad.creative.image_url ||
            ad.creative.thumbnail_url ||
            null,
          videoUrl: ad.creative.object_story_spec?.video_data?.video_url ||
            ad.creative.asset_feed_spec?.videos?.[0]?.url ||
            null,
          videoId,
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

    // Enrich video creatives with direct source URLs when available.
    const videoIds = Array.from(
      new Set(
        Array.from(creativeMap.values())
          .map((creative: any) => creative.videoId)
          .filter(Boolean),
      ),
    );
    const videoSourceMap = await this.fetchVideoSources(videoIds, accessToken);
    for (const creative of creativeMap.values()) {
      if (creative.videoId) {
        creative.videoUrl = videoSourceMap.get(creative.videoId) || undefined;
      }
      delete creative.videoId;
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

  private async fetchVideoSources(
    videoIds: string[],
    accessToken: string,
  ): Promise<Map<string, string>> {
    const sourceMap = new Map<string, string>();
    if (!videoIds.length) return sourceMap;

    const now = Date.now();
    const unresolved: string[] = [];
    for (const videoId of videoIds) {
      const cached = this.videoSourceCache.get(videoId);
      if (cached && cached.expiresAt > now) {
        sourceMap.set(videoId, cached.source);
      } else {
        unresolved.push(videoId);
      }
    }

    const maxLookupsPerRequest = 20;
    const concurrency = 4;
    const limitedIds = unresolved.slice(0, maxLookupsPerRequest);

    for (let i = 0; i < limitedIds.length; i += concurrency) {
      const chunk = limitedIds.slice(i, i + concurrency);
      const tasks = chunk.map(async (videoId) => {
        try {
          const result = await this.makeGraphApiCall(`/${videoId}`, accessToken, {
            fields: 'source',
          });
          if (result?.source) {
            sourceMap.set(videoId, result.source);
            this.videoSourceCache.set(videoId, {
              source: result.source,
              expiresAt: Date.now() + 12 * 60 * 60 * 1000,
            });
          }
        } catch {
          // Ignore per-video errors and continue.
        }
      });
      await Promise.all(tasks);
    }

    return sourceMap;
  }

  async getDemographics(
    adAccountId: string,
    accessToken: string,
    dateRange: string,
  ): Promise<any> {
    const dateParams = this.getDateParams(dateRange);

    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/insights`,
      accessToken,
      {
        fields: 'impressions,clicks,spend,actions',
        ...dateParams,
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
    const dateParams = this.getDateParams(dateRange);

    const result = await this.makeGraphApiCall(
      `/act_${adAccountId}/adsets`,
      accessToken,
      {
        fields:
          'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,campaign{id,name},targeting,optimization_goal',
        limit: '50',
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
        ...dateParams,
        limit: '50',
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
      fields: 'id,name,title,body,thumbnail_url,image_url,object_story_spec,asset_feed_spec,video_id',
    });

    // Transform snake_case to camelCase for frontend compatibility
    return {
      ...result,
      thumbnailUrl: result.thumbnail_url || result.image_url,
      imageUrl: result.object_story_spec?.link_data?.picture ||
        result.object_story_spec?.video_data?.image_url ||
        result.object_story_spec?.photo_data?.url ||
        result.object_story_spec?.link_data?.child_attachments?.[0]?.picture ||
        result.asset_feed_spec?.images?.[0]?.url ||
        result.image_url ||
        result.thumbnail_url ||
        null,
      videoUrl: result.object_story_spec?.video_data?.video_url ||
        result.asset_feed_spec?.videos?.[0]?.url ||
        null,
    };
  }
}
