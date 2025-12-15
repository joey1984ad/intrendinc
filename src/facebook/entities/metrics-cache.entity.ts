import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
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

  @Column({ name: 'metric_name' })
  metricName: string;

  @Column({ name: 'metric_value', type: 'text' })
  metricValue: string;

  @Column({ name: 'date_range', nullable: true })
  dateRange: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
