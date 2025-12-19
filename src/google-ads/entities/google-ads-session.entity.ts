import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('google_ads_sessions')
export class GoogleAdsSession {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'access_token', type: 'text' })
  accessToken: string;

  @Column({ name: 'refresh_token', type: 'text', nullable: true })
  refreshToken: string;

  @Column({ name: 'customer_id', nullable: true })
  customerId: string;

  @Column({ name: 'customer_name', nullable: true })
  customerName: string;

  @Column({ name: 'manager_customer_id', nullable: true })
  managerCustomerId: string;

  @Column({ name: 'token_expires_at', nullable: true })
  tokenExpiresAt: Date;

  @Column({ name: 'login_customer_id', nullable: true })
  loginCustomerId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
