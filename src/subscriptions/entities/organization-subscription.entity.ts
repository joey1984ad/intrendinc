import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('organization_subscriptions')
export class OrganizationSubscription {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_subscription_id', unique: true })
  stripeSubscriptionId: string;

  @Column({ name: 'stripe_customer_id' })
  stripeCustomerId: string;

  @Column({ name: 'plan_id' })
  planId: string;

  @Column({ name: 'plan_name' })
  planName: string;

  @Column({ name: 'billing_cycle' })
  billingCycle: string;

  @Column()
  status: string;

  @Column({ default: 1 })
  quantity: number;

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
