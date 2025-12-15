import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('tiktok_campaign_data')
@Index(['userId', 'advertiserId'])
export class TikTokCampaignData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'advertiser_id' })
  advertiserId: string;

  @Column({ name: 'campaign_id' })
  campaignId: string;

  @Column({ name: 'campaign_name' })
  campaignName: string;

  @Column({ name: 'campaign_status' })
  campaignStatus: string;

  @Column({ name: 'objective', nullable: true })
  objective: string;

  @Column({ name: 'budget', type: 'decimal', precision: 12, scale: 2, nullable: true })
  budget: number;

  @Column({ name: 'budget_mode', nullable: true })
  budgetMode: string; // 'BUDGET_MODE_DAY', 'BUDGET_MODE_TOTAL'

  @Column({ name: 'campaign_data', type: 'jsonb', nullable: true })
  campaignData: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
