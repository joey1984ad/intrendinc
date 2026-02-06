import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrganizationSubscription } from './organization-subscription.entity';

@Entity('organization_billing_history')
@Index('idx_organization_billing_history_subscription_id', ['organizationSubscriptionId'])
@Index('idx_organization_billing_history_user_id', ['userId'])
export class OrganizationBillingHistory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'organization_subscription_id', nullable: true })
  organizationSubscriptionId: number;

  @ManyToOne(() => OrganizationSubscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_subscription_id' })
  organizationSubscription: OrganizationSubscription;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_invoice_id', type: 'varchar', length: 255 })
  stripeInvoiceId: string;

  @Column({ name: 'amount_cents' })
  amountCents: number;

  @Column()
  quantity: number;

  @Column({ name: 'billing_period_start', type: 'timestamp' })
  billingPeriodStart: Date;

  @Column({ name: 'billing_period_end', type: 'timestamp' })
  billingPeriodEnd: Date;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'paid' })
  status: string;

  @Column({ name: 'paid_at', type: 'timestamp', nullable: true })
  paidAt: Date;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
