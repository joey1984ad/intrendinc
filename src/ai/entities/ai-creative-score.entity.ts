import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('ai_creative_scores')
@Index('idx_ai_creative_scores_creative_id', ['creativeId'])
@Index('idx_ai_creative_scores_ad_account_id', ['adAccountId'])
export class AiCreativeScore {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'creative_id', type: 'varchar', length: 255 })
  creativeId: string;

  @Column({ name: 'ad_account_id', type: 'varchar', length: 255 })
  adAccountId: string;

  @Column({ type: 'decimal', precision: 3, scale: 2 })
  score: number;

  @Column({ type: 'jsonb', name: 'analysis_data', nullable: true })
  analysisData: any;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
