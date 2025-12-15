import { Logger } from '@nestjs/common';
import { AdPlatform, PlatformSession, PlatformMetrics, PlatformCampaign, PlatformAdGroup, PlatformAd, PlatformDateRange, PlatformApiResponse } from '../interfaces/ad-platform.interface';

/**
 * Abstract base service for all ad platform integrations
 * Provides common functionality and enforces consistent API across platforms
 */
export abstract class BaseAdPlatformService {
  protected abstract readonly platform: AdPlatform;
  protected abstract readonly logger: Logger;
  protected abstract readonly apiVersion: string;
  protected abstract readonly baseUrl: string;

  // Session Management
  abstract saveSession(userId: number, accessToken: string, refreshToken?: string, adAccountId?: string, tokenExpiresAt?: Date): Promise<PlatformSession>;
  abstract getSession(userId: number): Promise<PlatformSession | null>;
  abstract deleteSession(userId: number): Promise<void>;
  abstract refreshAccessToken(userId: number): Promise<PlatformSession>;

  // Campaign Operations
  abstract getCampaigns(accessToken: string, adAccountId: string, dateRange?: PlatformDateRange): Promise<PlatformApiResponse<PlatformCampaign[]>>;
  abstract getCampaign(accessToken: string, campaignId: string): Promise<PlatformApiResponse<PlatformCampaign>>;

  // Ad Group Operations
  abstract getAdGroups(accessToken: string, campaignId: string, dateRange?: PlatformDateRange): Promise<PlatformApiResponse<PlatformAdGroup[]>>;
  abstract getAdGroup(accessToken: string, adGroupId: string): Promise<PlatformApiResponse<PlatformAdGroup>>;

  // Ad Operations
  abstract getAds(accessToken: string, adGroupId: string, dateRange?: PlatformDateRange): Promise<PlatformApiResponse<PlatformAd[]>>;
  abstract getAd(accessToken: string, adId: string): Promise<PlatformApiResponse<PlatformAd>>;

  // Metrics
  abstract getAccountMetrics(accessToken: string, adAccountId: string, dateRange: PlatformDateRange): Promise<PlatformApiResponse<PlatformMetrics>>;
  abstract getCampaignMetrics(accessToken: string, campaignId: string, dateRange: PlatformDateRange): Promise<PlatformApiResponse<PlatformMetrics>>;

  // Common utility methods
  protected async makeApiCall<T>(
    url: string,
    accessToken: string,
    params?: Record<string, any>,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${accessToken}`,
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

    try {
      const response = await fetch(finalUrl, options);
      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`API call failed: ${response.status} - ${errorText}`);
        throw new Error(`API call failed: ${response.status}`);
      }
      return response.json();
    } catch (error) {
      this.logger.error(`API call error: ${error}`);
      throw error;
    }
  }

  protected formatDateRange(dateRange: PlatformDateRange): { since: string; until: string } {
    return {
      since: dateRange.since,
      until: dateRange.until,
    };
  }

  protected calculateCTR(clicks: number, impressions: number): number {
    if (impressions === 0) return 0;
    return (clicks / impressions) * 100;
  }

  protected calculateCPC(spend: number, clicks: number): number {
    if (clicks === 0) return 0;
    return spend / clicks;
  }

  protected calculateCPM(spend: number, impressions: number): number {
    if (impressions === 0) return 0;
    return (spend / impressions) * 1000;
  }

  protected calculateROAS(revenue: number, spend: number): number {
    if (spend === 0) return 0;
    return revenue / spend;
  }
}
