import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TikTokSession } from './tiktok-session.entity';

@Entity('tiktok_metrics_cache')
@Index(['advertiserId', 'metricType', 'dateRange'])
export class TikTokMetricsCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id', nullable: true })
  sessionId: number;

  @ManyToOne(() => TikTokSession)
  @JoinColumn({ name: 'session_id' })
  session: TikTokSession;

  @Column({ name: 'advertiser_id' })
  advertiserId: string;

  @Column({ name: 'metric_type' })
  metricType: string; // 'campaign', 'adgroup', 'ad', 'account'

  @Column({ name: 'entity_id', nullable: true })
  entityId: string; // campaign_id, adgroup_id, ad_id

  @Column({ name: 'metric_data', type: 'jsonb' })
  metricData: Record<string, any>;

  @Column({ name: 'date_range', nullable: true })
  dateRange: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
