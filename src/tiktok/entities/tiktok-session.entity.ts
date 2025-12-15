import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('tiktok_sessions')
export class TikTokSession {
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

  @Column({ name: 'advertiser_id', nullable: true })
  advertiserId: string;

  @Column({ name: 'advertiser_name', nullable: true })
  advertiserName: string;

  @Column({ name: 'token_expires_at', nullable: true })
  tokenExpiresAt: Date;

  @Column({ name: 'refresh_token_expires_at', nullable: true })
  refreshTokenExpiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
