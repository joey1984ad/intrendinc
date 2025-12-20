import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrganizationSubscription } from './organization-subscription.entity';

@Entity('organization_seats')
export class OrganizationSeat {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'organization_subscription_id' })
  organizationSubscriptionId: number;

  @ManyToOne(() => OrganizationSubscription)
  @JoinColumn({ name: 'organization_subscription_id' })
  organizationSubscription: OrganizationSubscription;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'ad_account_id' })
  adAccountId: string;

  @Column({ name: 'ad_account_name' })
  adAccountName: string;

  @Column({ default: 'facebook' })
  platform: string; // 'facebook' | 'google' | 'tiktok'

  @Column({ default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'added_at' })
  addedAt: Date;

  @Column({ name: 'removed_at', nullable: true })
  removedAt: Date;
}

