import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BigQuery, Dataset, Table } from '@google-cloud/bigquery';

/**
 * BigQuery table schemas for Google Ads data
 */
const TABLE_SCHEMAS = {
  daily_account_metrics: [
    { name: 'user_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'customer_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'impressions', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'clicks', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'cost_micros', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'conversions', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'conversions_value', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'synced_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
  campaigns: [
    { name: 'user_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'customer_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'campaign_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'channel_type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'bidding_strategy', type: 'STRING', mode: 'NULLABLE' },
    { name: 'budget_micros', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'budget_type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'start_date', type: 'STRING', mode: 'NULLABLE' },
    { name: 'end_date', type: 'STRING', mode: 'NULLABLE' },
    { name: 'impressions', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'clicks', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'cost_micros', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'conversions', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'conversions_value', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'synced_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
  ad_groups: [
    { name: 'user_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'customer_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'campaign_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ad_group_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'cpc_bid_micros', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'impressions', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'clicks', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'cost_micros', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'conversions', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'synced_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
  ads: [
    { name: 'user_id', type: 'INTEGER', mode: 'REQUIRED' },
    { name: 'customer_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'date', type: 'DATE', mode: 'REQUIRED' },
    { name: 'campaign_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ad_group_id', type: 'STRING', mode: 'NULLABLE' },
    { name: 'ad_id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'name', type: 'STRING', mode: 'NULLABLE' },
    { name: 'type', type: 'STRING', mode: 'NULLABLE' },
    { name: 'status', type: 'STRING', mode: 'NULLABLE' },
    { name: 'final_urls', type: 'STRING', mode: 'NULLABLE' },
    { name: 'impressions', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'clicks', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'cost_micros', type: 'INTEGER', mode: 'NULLABLE' },
    { name: 'conversions', type: 'FLOAT', mode: 'NULLABLE' },
    { name: 'synced_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  ],
};

@Injectable()
export class BigQueryService implements OnModuleInit {
  private readonly logger = new Logger(BigQueryService.name);
  private bigquery: BigQuery;
  private dataset: Dataset;
  private readonly projectId: string;
  private readonly datasetId: string;
  private readonly location: string;
  private initialized = false;

  constructor(private readonly configService: ConfigService) {
    const bqConfig = this.configService.get('bigquery');
    this.projectId = bqConfig?.projectId || '';
    this.datasetId = bqConfig?.dataset || 'google_ads_data';
    this.location = bqConfig?.location || 'US';

    if (!this.projectId) {
      this.logger.warn('GCP_PROJECT_ID not set — BigQuery features will be disabled');
      return;
    }

    this.bigquery = new BigQuery({
      projectId: this.projectId,
      keyFilename: bqConfig?.keyFilePath,
    });
    this.dataset = this.bigquery.dataset(this.datasetId);
  }

  async onModuleInit(): Promise<void> {
    if (!this.projectId) {
      this.logger.warn('BigQuery initialization skipped — no project ID configured');
      return;
    }

    try {
      await this.ensureDatasetExists();
      await this.ensureTablesExist();
      this.initialized = true;
      this.logger.log(`BigQuery initialized: project=${this.projectId}, dataset=${this.datasetId}`);
    } catch (error: any) {
      this.logger.error(`BigQuery initialization failed: ${error.message}`, error.stack);
    }
  }

  /**
   * Check if BigQuery is properly configured and initialized
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Create the dataset if it doesn't exist
   */
  private async ensureDatasetExists(): Promise<void> {
    const [exists] = await this.dataset.exists();
    if (!exists) {
      this.logger.log(`Creating BigQuery dataset: ${this.datasetId}`);
      await this.bigquery.createDataset(this.datasetId, { location: this.location });
      this.dataset = this.bigquery.dataset(this.datasetId);
    }
  }

  /**
   * Create all required tables with partitioning and clustering
   */
  private async ensureTablesExist(): Promise<void> {
    for (const [tableName, schema] of Object.entries(TABLE_SCHEMAS)) {
      const table = this.dataset.table(tableName);
      const [exists] = await table.exists();

      if (!exists) {
        this.logger.log(`Creating BigQuery table: ${this.datasetId}.${tableName}`);
        await this.dataset.createTable(tableName, {
          schema: { fields: schema },
          timePartitioning: {
            type: 'DAY',
            field: 'date',
          },
          clustering: {
            fields: ['customer_id', 'user_id'],
          },
        });
      }
    }
  }

  /**
   * Run a parameterized query against BigQuery
   */
  async query<T = any>(sql: string, params?: Record<string, any>): Promise<T[]> {
    if (!this.initialized) {
      throw new Error('BigQuery is not initialized');
    }

    const options: any = {
      query: sql,
      location: this.location,
    };

    if (params) {
      options.params = params;
    }

    const [rows] = await this.bigquery.query(options);
    return rows as T[];
  }

  /**
   * Insert rows into a BigQuery table using streaming insert
   */
  async insertRows(tableName: string, rows: Record<string, any>[]): Promise<void> {
    if (!this.initialized) {
      throw new Error('BigQuery is not initialized');
    }

    if (rows.length === 0) return;

    const table = this.dataset.table(tableName);

    // BigQuery streaming insert has a 10,000 row per request limit
    const BATCH_SIZE = 5000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      await table.insert(batch, {
        skipInvalidRows: false,
        ignoreUnknownValues: false,
      });
    }
  }

  /**
   * Delete rows matching conditions (for upsert pattern: delete then insert)
   * Uses DML DELETE statement
   */
  async deleteRows(
    tableName: string,
    conditions: { userId: number; customerId: string; startDate: string; endDate: string },
  ): Promise<number> {
    if (!this.initialized) {
      throw new Error('BigQuery is not initialized');
    }

    const sql = `
      DELETE FROM \`${this.projectId}.${this.datasetId}.${tableName}\`
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
    `;

    const [job] = await this.bigquery.createQueryJob({
      query: sql,
      location: this.location,
      params: {
        userId: conditions.userId,
        customerId: conditions.customerId,
        startDate: conditions.startDate,
        endDate: conditions.endDate,
      },
    });

    const [result] = await job.getQueryResults();
    return (job.metadata?.statistics?.query?.numDmlAffectedRows as number) || 0;
  }

  /**
   * Check if data exists for a given user/customer/date range
   */
  async hasData(
    tableName: string,
    userId: number,
    customerId: string,
    startDate: string,
    endDate: string,
  ): Promise<boolean> {
    if (!this.initialized) return false;

    const sql = `
      SELECT COUNT(*) as count
      FROM \`${this.projectId}.${this.datasetId}.${tableName}\`
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
      LIMIT 1
    `;

    const rows = await this.query(sql, {
      userId,
      customerId,
      startDate,
      endDate,
    });

    return rows.length > 0 && rows[0].count > 0;
  }

  /**
   * Get the full table reference for use in raw queries
   */
  getTableRef(tableName: string): string {
    return `\`${this.projectId}.${this.datasetId}.${tableName}\``;
  }
}
