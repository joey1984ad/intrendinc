import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { TikTokSession } from './tiktok-session.entity';

@Entity('tiktok_creatives_cache')
@Index(['advertiserId', 'creativeType'])
export class TikTokCreativesCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id', nullable: true })
  sessionId: number;

  @ManyToOne(() => TikTokSession)
  @JoinColumn({ name: 'session_id' })
  session: TikTokSession;

  @Column({ name: 'advertiser_id' })
  advertiserId: string;

  @Column({ name: 'creative_id' })
  creativeId: string;

  @Column({ name: 'creative_type' })
  creativeType: string; // 'image', 'video', 'carousel'

  @Column({ name: 'creative_data', type: 'jsonb' })
  creativeData: Record<string, any>;

  @Column({ name: 'thumbnail_url', nullable: true })
  thumbnailUrl: string;

  @Column({ name: 'video_url', nullable: true })
  videoUrl: string;

  @Column({ name: 'image_url', nullable: true })
  imageUrl: string;

  @Column({ name: 'expires_at' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
