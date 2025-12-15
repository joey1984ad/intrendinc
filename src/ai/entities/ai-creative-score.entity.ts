import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('ai_creative_scores')
export class AiCreativeScore {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'creative_id' })
  creativeId: string;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ type: 'decimal', precision: 3, scale: 2 })
  score: number;

  @Column({ type: 'jsonb', name: 'analysis_data', nullable: true })
  analysisData: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
