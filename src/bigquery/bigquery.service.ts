import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BigQuery, Dataset, Table } from '@google-cloud/bigquery';
import * as path from 'path';

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

    this.logger.log(`[BQ CONSTRUCTOR] projectId=${this.projectId} datasetId=${this.datasetId} location=${this.location}`);
    this.logger.log(`[BQ CONSTRUCTOR] Raw bqConfig: ${JSON.stringify(bqConfig)}`);
    this.logger.log(`[BQ CONSTRUCTOR] process.cwd()=${process.cwd()}`);

    if (!this.projectId) {
      this.logger.error('[BQ CONSTRUCTOR] GCP_PROJECT_ID is empty — BigQuery will be disabled. Check that GCP_PROJECT_ID is set in .env');
      return;
    }

    const keyPath = bqConfig?.keyFilePath || './certificates/gcp-service-account.json';
    const absoluteKeyPath = path.isAbsolute(keyPath)
      ? keyPath
      : path.join(process.cwd(), keyPath);

    this.logger.log(`[BQ CONSTRUCTOR] keyPath (raw)=${keyPath}`);
    this.logger.log(`[BQ CONSTRUCTOR] absoluteKeyPath=${absoluteKeyPath}`);

    // Check file exists
    const fs = require('fs');
    const fileExists = fs.existsSync(absoluteKeyPath);
    this.logger.log(`[BQ CONSTRUCTOR] key file exists=${fileExists}`);
    if (fileExists) {
      const stat = fs.statSync(absoluteKeyPath);
      this.logger.log(`[BQ CONSTRUCTOR] key file size=${stat.size} bytes`);
    } else {
      this.logger.error(`[BQ CONSTRUCTOR] KEY FILE NOT FOUND at ${absoluteKeyPath}`);
    }

    this.bigquery = new BigQuery({
      projectId: this.projectId,
      keyFilename: absoluteKeyPath,
    });
    this.dataset = this.bigquery.dataset(this.datasetId);
    this.logger.log(`[BQ CONSTRUCTOR] BigQuery client created`);
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`[BQ INIT] onModuleInit called. projectId=${this.projectId}`);

    if (!this.projectId) {
      this.logger.error('[BQ INIT] Skipping — no project ID. Make sure GCP_PROJECT_ID is in .env');
      return;
    }

    try {
      this.logger.log(`[BQ INIT] Checking dataset exists: ${this.datasetId}`);
      await this.ensureDatasetExists();
      this.logger.log(`[BQ INIT] Dataset OK. Checking tables...`);
      await this.ensureTablesExist();
      this.initialized = true;
      this.logger.log(`[BQ INIT] SUCCESS — project=${this.projectId}, dataset=${this.datasetId}`);
    } catch (error: any) {
      this.logger.error(`[BQ INIT] FAILED: ${error.message}`);
      this.logger.error(`[BQ INIT] Error code: ${error.code}`);
      this.logger.error(`[BQ INIT] Error status: ${error.status}`);
      this.logger.error(`[BQ INIT] Full error: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      if (error.stack) {
        this.logger.error(`[BQ INIT] Stack: ${error.stack}`);
      }
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

    if (rows.length === 0) {
      this.logger.log(`[BQ INSERT] table=${tableName} — 0 rows, skipping`);
      return;
    }

    this.logger.log(`[BQ INSERT] table=${tableName} rowCount=${rows.length}`);
    const table = this.dataset.table(tableName);
    const batchRows = (batch: Record<string, any>[]) =>
      batch.map((row) => ({
        insertId: this.buildInsertId(tableName, row),
        json: row,
      }));

    const BATCH_SIZE = 5000;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      this.logger.log(`[BQ INSERT] Inserting batch ${Math.floor(i/BATCH_SIZE)+1} (rows ${i}–${i+batch.length})`);
      try {
        await table.insert(batchRows(batch), {
          skipInvalidRows: false,
          ignoreUnknownValues: false,
        });
        this.logger.log(`[BQ INSERT] Batch OK`);
      } catch (error: any) {
        this.logger.error(`[BQ INSERT] FAILED on table=${tableName} batch at row ${i}: ${error.message}`);
        this.logger.error(`[BQ INSERT] code=${error.code} status=${error.status}`);
        if (error.errors) {
          this.logger.error(`[BQ INSERT] row errors: ${JSON.stringify(error.errors?.slice(0, 5))}`);
        }
        this.logger.error(`[BQ INSERT] full=${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
        throw error;
      }
    }
    this.logger.log(`[BQ INSERT] table=${tableName} all batches done`);
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

    const sql = (startDate: string, endDate: string) => `
      DELETE FROM \`${this.projectId}.${this.datasetId}.${tableName}\`
      WHERE user_id = @userId
        AND customer_id = @customerId
        AND date BETWEEN @startDate AND @endDate
    `;

    this.logger.log(`[BQ DELETE] table=${tableName} userId=${conditions.userId} customerId=${conditions.customerId} range=${conditions.startDate}→${conditions.endDate}`);
    this.logger.log(`[BQ DELETE] SQL: ${sql(conditions.startDate, conditions.endDate).trim()}`);

    try {
      const [job] = await this.bigquery.createQueryJob({
        query: sql(conditions.startDate, conditions.endDate),
        location: this.location,
        params: {
          userId: conditions.userId,
          customerId: conditions.customerId,
          startDate: conditions.startDate,
          endDate: conditions.endDate,
        },
      });
      this.logger.log(`[BQ DELETE] Job created: ${job.id}`);

      const [result] = await job.getQueryResults();
      const affected = (job.metadata?.statistics?.query?.numDmlAffectedRows as number) || 0;
      this.logger.log(`[BQ DELETE] Done. rows affected=${affected}`);
      return affected;
    } catch (error: any) {
      const message = String(error?.message || '');
      if (message.includes('streaming buffer')) {
        const safeEndDate = this.subtractDays(conditions.endDate, 1);
        if (!safeEndDate || safeEndDate < conditions.startDate) {
          this.logger.warn(
            `[BQ DELETE] streaming buffer active; skipping delete for ${tableName} range=${conditions.startDate}→${conditions.endDate}`,
          );
          return 0;
        }
        this.logger.warn(
          `[BQ DELETE] streaming buffer active; retrying delete for ${tableName} range=${conditions.startDate}→${safeEndDate}`,
        );
        const [job] = await this.bigquery.createQueryJob({
          query: sql(conditions.startDate, safeEndDate),
          location: this.location,
          params: {
            userId: conditions.userId,
            customerId: conditions.customerId,
            startDate: conditions.startDate,
            endDate: safeEndDate,
          },
        });
        const [result] = await job.getQueryResults();
        const affected = (job.metadata?.statistics?.query?.numDmlAffectedRows as number) || 0;
        this.logger.log(`[BQ DELETE] Done after retry. rows affected=${affected}`);
        return affected;
      }

      this.logger.error(`[BQ DELETE] FAILED on table=${tableName}: ${message}`);
      this.logger.error(`[BQ DELETE] code=${error.code} status=${error.status}`);
      this.logger.error(`[BQ DELETE] full=${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      throw error;
    }
  }

  private buildInsertId(tableName: string, row: Record<string, any>): string {
    const safe = (value: any) => (value === undefined || value === null ? '' : String(value));
    switch (tableName) {
      case 'daily_account_metrics':
        return `${safe(row.user_id)}:${safe(row.customer_id)}:${safe(row.date)}`;
      case 'campaigns':
        return `${safe(row.user_id)}:${safe(row.customer_id)}:${safe(row.date)}:${safe(row.campaign_id)}`;
      case 'ad_groups':
        return `${safe(row.user_id)}:${safe(row.customer_id)}:${safe(row.date)}:${safe(row.ad_group_id)}`;
      case 'ads':
        return `${safe(row.user_id)}:${safe(row.customer_id)}:${safe(row.date)}:${safe(row.ad_id)}`;
      default:
        return `${tableName}:${safe(row.user_id)}:${safe(row.customer_id)}:${safe(row.date)}`;
    }
  }

  private subtractDays(dateStr: string, days: number): string | null {
    if (!dateStr) return null;
    const date = new Date(`${dateStr}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) return null;
    date.setUTCDate(date.getUTCDate() - days);
    return date.toISOString().slice(0, 10);
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
