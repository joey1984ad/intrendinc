import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity('creatives_cache')
@Index('idx_creatives_cache_key', ['adAccountId', 'dateRange'])
export class CreativesCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'ad_account_id', type: 'varchar', length: 255 })
  adAccountId: string;

  @Column({ name: 'date_range', type: 'varchar', length: 20 })
  dateRange: string;

  @Column({ type: 'jsonb' })
  payload: any;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
