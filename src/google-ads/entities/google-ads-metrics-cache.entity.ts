import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('google_ads_metrics_cache')
@Index(['userId', 'customerId', 'dateRange'])
export class GoogleAdsMetricsCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'date_range' })
  dateRange: string; // e.g., "2024-01-01_2024-01-31"

  @Column({ name: 'metrics_data', type: 'jsonb' })
  metricsData: {
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    cpc: number;
    cpm: number;
    ctr: number;
    costPerConversion: number;
    conversionsValue: number;
    roas: number;
  };

  @Column({ name: 'campaigns_data', type: 'jsonb', nullable: true })
  campaignsData: any[];

  @Column({ name: 'ad_groups_data', type: 'jsonb', nullable: true })
  adGroupsData: any[];

  @Column({ name: 'ads_data', type: 'jsonb', nullable: true })
  adsData: any[];

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
