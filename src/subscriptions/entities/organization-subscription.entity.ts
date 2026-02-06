import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('organization_subscriptions')
@Index('idx_organization_subscriptions_user_id', ['userId'])
@Index('idx_organization_subscriptions_status', ['status'])
@Index('idx_organization_subscriptions_stripe_id', ['stripeSubscriptionId'])
export class OrganizationSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_subscription_id', type: 'varchar', length: 255 })
  @Index('organization_subscriptions_stripe_subscription_id_key', { unique: true })
  stripeSubscriptionId: string;

  @Column({ name: 'stripe_customer_id', type: 'varchar', length: 255 })
  stripeCustomerId: string;

  @Column({ name: 'plan_id', type: 'varchar', length: 100 })
  planId: string;

  @Column({ name: 'plan_name', type: 'varchar', length: 100 })
  planName: string;

  @Column({ name: 'billing_cycle', type: 'varchar', length: 20 })
  billingCycle: string;

  @Column({ type: 'varchar', length: 50 })
  status: string;

  @Column({ default: 1 })
  quantity: number;

  @Column({ name: 'current_period_start', type: 'timestamp' })
  currentPeriodStart: Date;

  @Column({ name: 'current_period_end', type: 'timestamp' })
  currentPeriodEnd: Date;

  @Column({ name: 'cancel_at_period_end', nullable: true, default: false })
  cancelAtPeriodEnd: boolean;

  @Column({ name: 'trial_end', type: 'timestamp', nullable: true })
  trialEnd: Date;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
