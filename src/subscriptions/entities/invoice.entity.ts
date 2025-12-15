import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Subscription } from './subscription.entity';

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_invoice_id', unique: true })
  stripeInvoiceId: string;

  @Column({ name: 'subscription_id', nullable: true })
  subscriptionId: number;

  @ManyToOne(() => Subscription)
  @JoinColumn({ name: 'subscription_id' })
  subscription: Subscription;

  @Column({ name: 'amount_paid' })
  amountPaid: number;

  @Column({ default: 'usd' })
  currency: string;

  @Column()
  status: string;

  @Column({ name: 'invoice_pdf_url', nullable: true, type: 'text' })
  invoicePdfUrl: string;

  @Column({ name: 'invoice_number', nullable: true })
  invoiceNumber: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
