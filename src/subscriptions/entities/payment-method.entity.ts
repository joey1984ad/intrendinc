import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('payment_methods')
@Index('idx_payment_methods_user_id', ['userId'])
export class PaymentMethod {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'stripe_payment_method_id', type: 'varchar', length: 255 })
  @Index('payment_methods_stripe_payment_method_id_key', { unique: true })
  stripePaymentMethodId: string;

  @Column({ type: 'varchar', length: 50 })
  type: string;

  @Column({ type: 'varchar', length: 4, nullable: true })
  last4: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  brand: string;

  @Column({ name: 'exp_month', nullable: true })
  expMonth: number;

  @Column({ name: 'exp_year', nullable: true })
  expYear: number;

  @Column({ name: 'is_default', nullable: true, default: false })
  isDefault: boolean;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
