import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { FacebookSession } from './facebook-session.entity';

@Entity('campaign_data')
export class CampaignData {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id', nullable: true })
  sessionId: number;

  @ManyToOne(() => FacebookSession)
  @JoinColumn({ name: 'session_id' })
  session: FacebookSession;

  @Column({ name: 'campaign_id' })
  campaignId: string;

  @Column({ name: 'campaign_name', nullable: true, length: 500 })
  campaignName: string;

  @Column({ default: 0 })
  clicks: number;

  @Column({ default: 0 })
  impressions: number;

  @Column({ default: 0 })
  reach: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  spend: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  cpc: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  cpm: number;

  @Column({ default: '0%' })
  ctr: string;

  @Column({ nullable: true })
  status: string;

  @Column({ nullable: true })
  objective: string;

  @Column({ name: 'date_range', nullable: true })
  dateRange: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
