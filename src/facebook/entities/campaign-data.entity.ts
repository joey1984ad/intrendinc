import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
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

  @Column({ name: 'campaign_id', type: 'varchar', length: 255 })
  campaignId: string;

  @Column({ name: 'campaign_name', type: 'varchar', length: 500, nullable: true })
  campaignName: string;

  @Column({ nullable: true, default: 0 })
  clicks: number;

  @Column({ nullable: true, default: 0 })
  impressions: number;

  @Column({ nullable: true, default: 0 })
  reach: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
  spend: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
  cpc: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
  cpm: number;

  @Column({ type: 'varchar', length: 10, nullable: true, default: '0%' })
  ctr: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  status: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  objective: string;

  @Column({ name: 'date_range', type: 'varchar', length: 20, nullable: true })
  dateRange: string;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
