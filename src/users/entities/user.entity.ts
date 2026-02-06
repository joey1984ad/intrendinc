import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255 })
  @Index('users_email_key', { unique: true })
  email: string;

  @Column({ name: 'first_name', type: 'varchar', length: 100, nullable: true })
  firstName: string;

  @Column({ name: 'last_name', type: 'varchar', length: 100, nullable: true })
  lastName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  company: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  password: string;

  @Column({ name: 'current_plan_id', type: 'varchar', length: 100, default: 'free' })
  currentPlanId: string;

  @Column({ name: 'current_plan_name', type: 'varchar', length: 100, default: 'Free' })
  currentPlanName: string;

  @Column({ name: 'current_billing_cycle', type: 'varchar', length: 20, default: 'monthly' })
  currentBillingCycle: string;

  @Column({ name: 'subscription_status', type: 'varchar', length: 50, default: 'inactive' })
  subscriptionStatus: string;

  @Column({ name: 'is_trial_user', default: false })
  isTrialUser: boolean;

  @Column({ name: 'trial_start', type: 'timestamp', nullable: true })
  trialStart: Date;

  @Column({ name: 'trial_end', type: 'timestamp', nullable: true })
  trialEnd: Date;

  @Column({ type: 'varchar', length: 50, default: 'user' })
  role: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
