import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('google_ads_campaign_data')
@Index(['userId', 'customerId', 'campaignId'])
export class GoogleAdsCampaignData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'customer_id' })
  customerId: string;

  @Column({ name: 'campaign_id' })
  campaignId: string;

  @Column({ name: 'campaign_name' })
  campaignName: string;

  @Column({ name: 'campaign_status' })
  campaignStatus: string;

  @Column({ name: 'campaign_type', nullable: true })
  campaignType: string;

  @Column({ name: 'advertising_channel', nullable: true })
  advertisingChannel: string;

  @Column({ name: 'budget_micros', type: 'bigint', nullable: true })
  budgetMicros: number;

  @Column({ name: 'budget_type', nullable: true })
  budgetType: string;

  @Column({ name: 'bidding_strategy', nullable: true })
  biddingStrategy: string;

  @Column({ name: 'start_date', nullable: true })
  startDate: string;

  @Column({ name: 'end_date', nullable: true })
  endDate: string;

  @Column({ name: 'metrics_snapshot', type: 'jsonb', nullable: true })
  metricsSnapshot: {
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number;
    ctr: number;
    cpc: number;
    date: string;
  };

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
