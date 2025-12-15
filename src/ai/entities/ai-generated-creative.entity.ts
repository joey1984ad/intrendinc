import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('ai_generated_creatives')
export class AiGeneratedCreative {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'ad_account_name', nullable: true, length: 500 })
  adAccountName: string;

  @Column({ name: 'creative_name', nullable: true, length: 500 })
  creativeName: string;

  @Column({ name: 'creative_type', length: 50 })
  creativeType: string;

  @Column({ name: 'source_creative_id', nullable: true })
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

  @Column({ name: 'is_favorite', default: false })
  isFavorite: boolean;

  @Column({ default: 'draft', length: 50 })
  status: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
