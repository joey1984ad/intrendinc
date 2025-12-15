import { registerAs } from '@nestjs/config';

export const tiktokConfig = registerAs('tiktok', () => ({
  appId: process.env.TIKTOK_APP_ID,
  appSecret: process.env.TIKTOK_APP_SECRET,
  redirectUri: process.env.TIKTOK_REDIRECT_URI || `${process.env.BACKEND_URL || 'http://localhost:3001'}/tiktok/auth/callback`,
  
  // API Configuration
  apiVersion: 'v1.3',
  baseUrl: 'https://business-api.tiktok.com/open_api',
  
  // Rate Limiting
  rateLimitRequests: parseInt(process.env.TIKTOK_RATE_LIMIT_REQUESTS || '10', 10),
  rateLimitWindow: parseInt(process.env.TIKTOK_RATE_LIMIT_WINDOW || '1000', 10), // milliseconds
  
  // Cache TTL
  cacheTTL: parseInt(process.env.TIKTOK_CACHE_TTL || '300000', 10), // 5 minutes default
}));

// TikTok API endpoints reference
export const TIKTOK_ENDPOINTS = {
  // OAuth
  AUTH_URL: 'https://business-api.tiktok.com/portal/auth',
  ACCESS_TOKEN: '/oauth2/access_token/',
  REFRESH_TOKEN: '/oauth2/refresh_token/',
  
  // Advertisers
  ADVERTISER_INFO: '/advertiser/info/',
  AUTHORIZED_ADVERTISERS: '/oauth2/advertiser/get/',
  
  // Campaigns
  CAMPAIGN_GET: '/campaign/get/',
  CAMPAIGN_CREATE: '/campaign/create/',
  CAMPAIGN_UPDATE: '/campaign/update/',
  
  // Ad Groups
  ADGROUP_GET: '/adgroup/get/',
  ADGROUP_CREATE: '/adgroup/create/',
  ADGROUP_UPDATE: '/adgroup/update/',
  
  // Ads
  AD_GET: '/ad/get/',
  AD_CREATE: '/ad/create/',
  AD_UPDATE: '/ad/update/',
  
  // Reports
  REPORT_INTEGRATED: '/report/integrated/get/',
  REPORT_AUDIENCE: '/report/audience/get/',
  
  // Creatives
  CREATIVE_GET: '/creative/get/',
  FILE_VIDEO_INFO: '/file/video/info/',
  FILE_IMAGE_INFO: '/file/image/info/',
} as const;

// TikTok Campaign Objectives
export const TIKTOK_OBJECTIVES = {
  REACH: 'REACH',
  TRAFFIC: 'TRAFFIC',
  VIDEO_VIEWS: 'VIDEO_VIEWS',
  LEAD_GENERATION: 'LEAD_GENERATION',
  COMMUNITY_INTERACTION: 'COMMUNITY_INTERACTION',
  APP_PROMOTION: 'APP_PROMOTION',
  WEBSITE_CONVERSIONS: 'WEBSITE_CONVERSIONS',
  PRODUCT_SALES: 'PRODUCT_SALES',
} as const;

// TikTok Ad Status
export const TIKTOK_AD_STATUS = {
  ENABLE: 'ENABLE',
  DISABLE: 'DISABLE',
  DELETE: 'DELETE',
} as const;
