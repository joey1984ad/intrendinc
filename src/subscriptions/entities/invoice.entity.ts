import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Subscription } from './subscription.entity';

@Entity('invoices')
@Index('idx_invoices_user_id', ['userId'])
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_invoice_id', type: 'varchar', length: 255 })
  @Index('invoices_stripe_invoice_id_key', { unique: true })
  stripeInvoiceId: string;

  @Column({ name: 'subscription_id', nullable: true })
  subscriptionId: number;

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'amount_paid' })
  amountPaid: number;

  @Column({ type: 'varchar', length: 3, nullable: true, default: 'usd' })
  currency: string;

  @Column({ type: 'varchar', length: 50 })
  status: string;

  @Column({ name: 'invoice_pdf_url', nullable: true, type: 'text' })
  invoicePdfUrl: string;

  @Column({ name: 'invoice_number', type: 'varchar', length: 255, nullable: true })
  invoiceNumber: string;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
