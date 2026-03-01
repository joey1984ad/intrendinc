import { registerAs } from '@nestjs/config';

export default registerAs('bigquery', () => ({
  // GCP Project
  projectId: process.env.GCP_PROJECT_ID || '',

  // BigQuery dataset name
  dataset: process.env.GCP_BIGQUERY_DATASET || 'google_ads_data',

  // Path to service account key JSON file
  keyFilePath: process.env.GCP_SERVICE_ACCOUNT_KEY_PATH || './certificates/gcp-service-account.json',

  // Sync configuration
  syncEnabled: process.env.BIGQUERY_SYNC_ENABLED !== 'false',
  syncIntervalHours: parseInt(process.env.BIGQUERY_SYNC_INTERVAL_HOURS || '6', 10),

  // Data retention: how many days of historical data to sync
  syncLookbackDays: parseInt(process.env.BIGQUERY_SYNC_LOOKBACK_DAYS || '90', 10),

  // Location for BigQuery dataset
  location: process.env.GCP_BIGQUERY_LOCATION || 'US',
}));
