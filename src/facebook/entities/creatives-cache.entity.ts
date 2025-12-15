import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('creatives_cache')
export class CreativesCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'date_range' })
  dateRange: string;

  @Column({ type: 'jsonb' })
  payload: any;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
