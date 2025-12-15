import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ name: 'first_name', length: 100, nullable: true })
  firstName: string;

  @Column({ name: 'last_name', length: 100, nullable: true })
  lastName: string;

  @Column({ length: 255, nullable: true })
  company: string;

  @Column({ length: 255, nullable: true })
  password: string;

  @Column({ name: 'current_plan_id', length: 100, default: 'free' })
  currentPlanId: string;

  @Column({ name: 'current_plan_name', length: 100, default: 'Free' })
  currentPlanName: string;

  @Column({ name: 'current_billing_cycle', length: 20, default: 'monthly' })
  currentBillingCycle: string;

  @Column({ name: 'subscription_status', length: 50, default: 'inactive' })
  subscriptionStatus: string;

  @Column({ name: 'is_trial_user', default: false })
  isTrialUser: boolean;

  @Column({ name: 'trial_start', type: 'timestamp', nullable: true })
  trialStart: Date;

  @Column({ name: 'trial_end', type: 'timestamp', nullable: true })
  trialEnd: Date;

  @Column({ length: 50, default: 'user' })
  role: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
