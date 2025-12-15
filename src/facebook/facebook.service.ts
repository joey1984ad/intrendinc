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
  ) {}

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
  async makeGraphApiCall(endpoint: string, accessToken: string, params?: Record<string, string>): Promise<any> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}${endpoint}`);
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
        throw new Error(error.error?.message || `Facebook API error: ${response.status}`);
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

  async getAds(adAccountId: string, accessToken: string, dateRange: string): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);
    
    const result = await this.makeGraphApiCall(`/act_${adAccountId}/ads`, accessToken, {
      fields: 'id,name,status,creative{id,name,thumbnail_url,object_story_spec},insights.date_preset(' + datePreset + '){impressions,clicks,spend,ctr,cpc,cpm,reach,frequency}',
      limit: '500',
    });

    return {
      ads: result.data || [],
      paging: result.paging,
    };
  }

  async getInsights(adAccountId: string, accessToken: string, dateRange: string): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);
    
    const result = await this.makeGraphApiCall(`/act_${adAccountId}/insights`, accessToken, {
      fields: 'impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions,conversions',
      date_preset: datePreset,
      level: 'account',
    });

    return result.data?.[0] || {};
  }

  async getCreatives(adAccountId: string, accessToken: string): Promise<any[]> {
    const result = await this.makeGraphApiCall(`/act_${adAccountId}/adcreatives`, accessToken, {
      fields: 'id,name,title,body,thumbnail_url,image_url,object_story_spec,effective_object_story_id',
      limit: '200',
    });

    return result.data || [];
  }

  async getDemographics(adAccountId: string, accessToken: string, dateRange: string): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);
    
    const result = await this.makeGraphApiCall(`/act_${adAccountId}/insights`, accessToken, {
      fields: 'impressions,clicks,spend,actions',
      date_preset: datePreset,
      breakdowns: 'age,gender',
    });

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
      'today': 'today',
      'yesterday': 'yesterday',
      'last_7d': 'last_7d',
      'last_14d': 'last_14d',
      'last_30d': 'last_30d',
      'last_90d': 'last_90d',
      'this_month': 'this_month',
      'last_month': 'last_month',
    };
    return presetMap[dateRange] || 'last_30d';
  }

  // Cache methods (unchanged)
  async saveCampaignData(sessionId: number, campaigns: any[], dateRange: string): Promise<void> {
    await this.campaignDataRepository.delete({ sessionId, dateRange });
    
    const entities = campaigns.map(campaign => this.campaignDataRepository.create({
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
    }));
    
    await this.campaignDataRepository.save(entities);
  }

  async getCampaignData(sessionId: number, dateRange: string): Promise<CampaignData[]> {
    return this.campaignDataRepository.find({
      where: { sessionId, dateRange },
      order: { spend: 'DESC' },
    });
  }

  async saveMetricsCache(sessionId: number, metrics: any[], dateRange: string): Promise<void> {
    await this.metricsCacheRepository.delete({ sessionId, dateRange });
    
    const entities = metrics.map(metric => this.metricsCacheRepository.create({
      sessionId,
      metricName: metric.label,
      metricValue: metric.value,
      dateRange,
    }));
    
    await this.metricsCacheRepository.save(entities);
  }

  async getMetricsCache(sessionId: number, dateRange: string): Promise<MetricsCache[]> {
    return this.metricsCacheRepository.find({
      where: { sessionId, dateRange },
    });
  }

  async saveCreativesCache(adAccountId: string, dateRange: string, payload: any): Promise<void> {
    await this.creativesCacheRepository.delete({ adAccountId, dateRange });
    
    const cache = this.creativesCacheRepository.create({
      adAccountId,
      dateRange,
      payload,
    });
    await this.creativesCacheRepository.save(cache);
  }

  async getCreativesCache(adAccountId: string, dateRange: string, maxAgeHours: number): Promise<any | null> {
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

  async clearCreativesCache(adAccountId?: string, dateRange?: string): Promise<void> {
    if (adAccountId && dateRange) {
      await this.creativesCacheRepository.delete({ adAccountId, dateRange });
    } else {
      await this.creativesCacheRepository.clear();
    }
  }

  async getAdsets(adAccountId: string, accessToken: string, dateRange: string): Promise<any> {
    const datePreset = this.getDatePreset(dateRange);
    
    const result = await this.makeGraphApiCall(`/act_${adAccountId}/adsets`, accessToken, {
      fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time,campaign{id,name},targeting,optimization_goal',
      limit: '200',
    });

    const adsets = result.data || [];

    // Fetch insights for adsets
    const insightsResult = await this.makeGraphApiCall(`/act_${adAccountId}/insights`, accessToken, {
      fields: 'adset_id,impressions,clicks,spend,reach,frequency,cpc,cpm,ctr,actions,action_values',
      level: 'adset',
      time_increment: 'all_days',
      date_preset: datePreset,
      limit: '200',
    });

    const insightsByAdset = new Map<string, any>();
    for (const insight of (insightsResult.data || [])) {
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

  async getAdPreview(adId: string, accessToken: string, format: string = 'DESKTOP_FEED_STANDARD'): Promise<any> {
    const fallbackFormats = [
      format,
      'MOBILE_FEED_STANDARD',
      'RIGHT_COLUMN_STANDARD',
      'DESKTOP_FEED_STANDARD',
      'MOBILE_BANNER',
    ];

    for (const fmt of fallbackFormats) {
      try {
        const result = await this.makeGraphApiCall(`/${adId}/previews`, accessToken, {
          ad_format: fmt,
        });

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

  async getCreativePreview(creativeId: string, accessToken: string): Promise<any> {
    const result = await this.makeGraphApiCall(`/${creativeId}`, accessToken, {
      fields: 'id,name,title,body,thumbnail_url,image_url,object_story_spec',
    });

    return result;
  }
}


