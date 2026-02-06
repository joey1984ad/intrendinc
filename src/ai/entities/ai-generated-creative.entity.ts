import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('ai_generated_creatives')
@Index('idx_ai_creatives_user_account', ['userId', 'adAccountId'])
@Index('idx_ai_creatives_type', ['creativeType'])
@Index('idx_ai_creatives_status', ['status'])
@Index('idx_ai_creatives_created', ['createdAt'])
@Index('idx_ai_creatives_tags', ['tags'])
export class AiGeneratedCreative {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'ad_account_id', type: 'varchar', length: 255 })
  adAccountId: string;

  @Column({ name: 'ad_account_name', type: 'varchar', length: 500, nullable: true })
  adAccountName: string;

  @Column({ name: 'creative_name', type: 'varchar', length: 500, nullable: true })
  creativeName: string;

  @Column({ name: 'creative_type', type: 'varchar', length: 50 })
  creativeType: string;

  @Column({ name: 'source_creative_id', type: 'varchar', length: 255, nullable: true })
  sourceCreativeId: string;

  @Column({ name: 'source_creative_url', nullable: true, type: 'text' })
  sourceCreativeUrl: string;

  @Column({ name: 'image_url', nullable: true, type: 'text' })
  imageUrl: string;

  @Column({ name: 'video_url', nullable: true, type: 'text' })
  videoUrl: string;

  @Column({ name: 'thumbnail_url', nullable: true, type: 'text' })
  thumbnailUrl: string;

  @Column({ type: 'jsonb', nullable: true })
  assets: any;

  @Column({ name: 'generation_prompt', nullable: true, type: 'text' })
  generationPrompt: string;

  @Column({ name: 'variation_plan', nullable: true, type: 'jsonb' })
  variationPlan: any;

  @Column({ name: 'analysis_data', nullable: true, type: 'jsonb' })
  analysisData: any;

  @Column({ name: 'optimization_goals', type: 'text', array: true, nullable: true })
  optimizationGoals: string[];

  @Column({ name: 'source_performance', nullable: true, type: 'jsonb' })
  sourcePerformance: any;

  @Column({ type: 'text', array: true, nullable: true })
  tags: string[];

  @Column({ nullable: true, type: 'text' })
  notes: string;

  @Column({ name: 'is_favorite', nullable: true, default: false })
  isFavorite: boolean;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'draft' })
  status: string;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
