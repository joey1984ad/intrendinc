import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrganizationSubscription } from './organization-subscription.entity';

@Entity('organization_billing_history')
export class OrganizationBillingHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'organization_subscription_id' })
  organizationSubscriptionId: number;

  @ManyToOne(() => OrganizationSubscription)
  @JoinColumn({ name: 'organization_subscription_id' })
  organizationSubscription: OrganizationSubscription;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_invoice_id' })
  stripeInvoiceId: string;

  @Column({ name: 'amount_cents' })
  amountCents: number;

  @Column()
  quantity: number;

  @Column({ name: 'billing_period_start' })
  billingPeriodStart: Date;

  @Column({ name: 'billing_period_end' })
  billingPeriodEnd: Date;

  @Column({ default: 'paid' })
  status: string;

  @Column({ name: 'paid_at', nullable: true })
  paidAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
