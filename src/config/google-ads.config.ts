import { registerAs } from '@nestjs/config';

export default registerAs('googleAds', () => ({
  // OAuth credentials
  clientId: process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
  developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '',
  
  // OAuth redirect URI
  redirectUri: process.env.GOOGLE_ADS_REDIRECT_URI || 'http://localhost:3001/google-ads/auth/callback',
  
  // API configuration
  apiVersion: 'v18', // Google Ads API version
  
  // Login customer ID (for MCC accounts)
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '',
  
  // Scopes required for Google Ads API
  scopes: [
    'https://www.googleapis.com/auth/adwords',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ],
  
  // Cache configuration
  cacheEnabled: process.env.GOOGLE_ADS_CACHE_ENABLED !== 'false',
  cacheTtlHours: parseInt(process.env.GOOGLE_ADS_CACHE_TTL_HOURS || '6', 10),
  
  // Rate limiting
  maxRequestsPerMinute: parseInt(process.env.GOOGLE_ADS_MAX_REQUESTS_PER_MINUTE || '100', 10),
  
  // Test mode (uses sandbox credentials)
  testMode: process.env.GOOGLE_ADS_TEST_MODE === 'true',
}));
