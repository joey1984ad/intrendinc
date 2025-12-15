import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('payment_methods')
export class PaymentMethod {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id' })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_payment_method_id', unique: true })
  stripePaymentMethodId: string;

  @Column()
  type: string;

  @Column({ nullable: true })
  last4: string;

  @Column({ nullable: true })
  brand: string;

  @Column({ name: 'exp_month', nullable: true })
  expMonth: number;

  @Column({ name: 'exp_year', nullable: true })
  expYear: number;

  @Column({ name: 'is_default', default: false })
  isDefault: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
