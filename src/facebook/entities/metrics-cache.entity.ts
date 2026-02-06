import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn } from 'typeorm';
import { FacebookSession } from './facebook-session.entity';

@Entity('metrics_cache')
export class MetricsCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'session_id', nullable: true })
  sessionId: number;

  @ManyToOne(() => FacebookSession)
  @JoinColumn({ name: 'session_id' })
  session: FacebookSession;

  @Column({ name: 'metric_name', type: 'varchar', length: 100 })
  metricName: string;

  @Column({ name: 'metric_value', type: 'text' })
  metricValue: string;

  @Column({ name: 'date_range', type: 'varchar', length: 20, nullable: true })
  dateRange: string;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
