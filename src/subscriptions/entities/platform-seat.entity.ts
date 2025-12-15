import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PlatformSubscription } from './platform-subscription.entity';
import { AdPlatform } from '../../common/interfaces/ad-platform.interface';

/**
 * Platform-specific ad account/seat entity
 * Tracks which ad accounts are associated with each platform subscription
 */
@Entity('platform_seats')
@Index(['subscriptionId', 'adAccountId'], { unique: true })
@Index(['userId', 'platform'])
export class PlatformSeat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'subscription_id' })
  subscriptionId: number;

  @ManyToOne(() => PlatformSubscription)
  @JoinColumn({ name: 'subscription_id' })
  subscription: PlatformSubscription;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: AdPlatform,
  })
  platform: AdPlatform;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'ad_account_name', nullable: true })
  adAccountName: string;

  @Column({ default: 'active' })
  status: string; // 'active' | 'inactive' | 'pending'

  @Column({ name: 'added_at' })
  addedAt: Date;

  @Column({ name: 'removed_at', nullable: true })
  removedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
