import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { OrganizationSubscription } from './organization-subscription.entity';

@Entity('organization_seats')
@Index('idx_organization_seats_subscription_id', ['organizationSubscriptionId'])
@Index('idx_organization_seats_user_id', ['userId'])
@Index('idx_organization_seats_status', ['status'])
@Index('organization_seats_organization_subscription_id_ad_account__key', ['organizationSubscriptionId', 'adAccountId'], { unique: true })
export class OrganizationSeat {
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

  @Column({ name: 'ad_account_id', type: 'varchar', length: 255 })
  adAccountId: string;

  @Column({ name: 'ad_account_name', type: 'varchar', length: 255 })
  adAccountName: string;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'facebook' })
  platform: string;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'active' })
  status: string;

  @Column({ name: 'added_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  addedAt: Date;

  @Column({ name: 'removed_at', type: 'timestamp', nullable: true })
  removedAt: Date;
}
