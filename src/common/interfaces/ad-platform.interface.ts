/**
 * Common interfaces for multi-platform ad integrations
 * Supports: Facebook, TikTok, Google Ads, and future platforms
 */

export enum AdPlatform {
  FACEBOOK = 'facebook',
  TIKTOK = 'tiktok',
  GOOGLE = 'google',
  LINKEDIN = 'linkedin',
  TWITTER = 'twitter',
  SNAPCHAT = 'snapchat',
}

export interface PlatformSession {
  id: number;
  userId: number;
  platform: AdPlatform;
  accessToken: string;
  refreshToken?: string;
  adAccountId?: string;
  tokenExpiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface PlatformMetrics {
  impressions: number;
  clicks: number;
  spend: number;
  reach?: number;
  frequency?: number;
  cpc: number;
  cpm: number;
  ctr: number;
  conversions?: number;
  costPerConversion?: number;
  roas?: number;
}

export interface PlatformCampaign {
  id: string;
  name: string;
  status: string;
  objective?: string;
  budget?: number;
  budgetType?: 'daily' | 'lifetime';
  startTime?: Date;
  endTime?: Date;
  metrics?: PlatformMetrics;
}

export interface PlatformAdGroup {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  targeting?: Record<string, any>;
  budget?: number;
  bidAmount?: number;
  metrics?: PlatformMetrics;
}

export interface PlatformAd {
  id: string;
  adGroupId: string;
  campaignId: string;
  name: string;
  status: string;
  creativeId?: string;
  creative?: PlatformCreative;
  metrics?: PlatformMetrics;
}

export interface PlatformCreative {
  id: string;
  type: 'image' | 'video' | 'carousel' | 'dynamic' | 'text';
  title?: string;
  body?: string;
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  callToAction?: string;
  landingUrl?: string;
}

export interface PlatformDateRange {
  since: string; // YYYY-MM-DD
  until: string; // YYYY-MM-DD
}

export interface PlatformApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: {
    hasMore: boolean;
    cursor?: string;
    page?: number;
    totalCount?: number;
  };
}

export interface AIAnalysisResult {
  score: number;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
  fatigueScore?: number;
  creativeQuality?: number;
  audienceMatch?: number;
  timestamp: Date;
}

export interface ImageOptimizationResult {
  originalUrl: string;
  optimizedUrl?: string;
  recommendations: string[];
  colorAnalysis?: {
    dominant: string[];
    contrast: number;
  };
  compositionScore?: number;
  textOverlayScore?: number;
}
