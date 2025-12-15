import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { AdPlatform } from '../../common/interfaces/ad-platform.interface';

/**
 * Platform-specific subscription entity
 * Each platform (Facebook, TikTok, Google Ads) has separate subscriptions
 */
@Entity('platform_subscriptions')
@Index(['userId', 'platform'])
@Index(['stripeSubscriptionId'], { unique: true })
export class PlatformSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({
    type: 'enum',
    enum: AdPlatform,
    default: AdPlatform.FACEBOOK,
  })
  platform: AdPlatform;

  @Column({ name: 'stripe_subscription_id', unique: true })
  stripeSubscriptionId: string;

  @Column({ name: 'stripe_customer_id' })
  stripeCustomerId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'plan_name' })
  planName: string;

  @Column({ name: 'billing_cycle' })
  billingCycle: string; // 'monthly' | 'annual'

  @Column()
  status: string; // 'active' | 'canceled' | 'past_due' | 'trialing'

  @Column()
  quantity: number; // Number of ad accounts

  @Column({ name: 'current_period_start' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end' })
  currentPeriodEnd: Date;

  @Column({ name: 'cancel_at_period_end', default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'trial_end', nullable: true })
  trialEnd: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
