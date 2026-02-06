import { Entity, Column, PrimaryGeneratedColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('shareable_links')
@Index('idx_shareable_links_user_id', ['userId'])
@Index('idx_shareable_links_token', ['token'])
@Index('idx_shareable_links_is_active', ['isActive'])
export class ShareableLink {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', nullable: true })
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar', length: 255 })
  @Index('shareable_links_token_key', { unique: true })
  token: string;

  @Column({ name: 'ad_account_id', type: 'varchar', length: 255, nullable: true })
  adAccountId: string;

  @Column({ name: 'expires_at', type: 'timestamp', nullable: true })
  expiresAt: Date;

  @Column({ name: 'max_uses', nullable: true })
  maxUses: number;

  @Column({ name: 'uses_count', nullable: true, default: 0 })
  usesCount: number;

  @Column({ name: 'is_active', nullable: true, default: true })
  isActive: boolean;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ name: 'updated_at', type: 'timestamp', nullable: true, default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
