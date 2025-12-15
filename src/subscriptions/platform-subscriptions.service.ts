import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformSubscription } from './entities/platform-subscription.entity';
import { PlatformSeat } from './entities/platform-seat.entity';
import { AdPlatform } from '../common/interfaces/ad-platform.interface';

@Injectable()
export class PlatformSubscriptionsService {
  constructor(
    @InjectRepository(PlatformSubscription)
    private platformSubscriptionRepository: Repository<PlatformSubscription>,
    @InjectRepository(PlatformSeat)
    private platformSeatRepository: Repository<PlatformSeat>,
  ) {}

  // ==================== PLATFORM SUBSCRIPTIONS ====================

  async createPlatformSubscription(data: Partial<PlatformSubscription>): Promise<PlatformSubscription> {
    const subscription = this.platformSubscriptionRepository.create(data);
    return this.platformSubscriptionRepository.save(subscription);
  }

  async getPlatformSubscription(userId: number, platform: AdPlatform): Promise<PlatformSubscription | null> {
    return this.platformSubscriptionRepository.findOne({
      where: [
        { userId, platform, status: 'active' },
        { userId, platform, status: 'trialing' },
        { userId, platform, status: 'past_due' },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async getPlatformSubscriptionByStripeId(stripeSubscriptionId: string): Promise<PlatformSubscription | null> {
    return this.platformSubscriptionRepository.findOneBy({ stripeSubscriptionId });
  }

  async getAllPlatformSubscriptions(userId: number): Promise<PlatformSubscription[]> {
    return this.platformSubscriptionRepository.find({
      where: { userId },
      order: { platform: 'ASC', createdAt: 'DESC' },
    });
  }

  async getActivePlatformSubscriptions(userId: number): Promise<PlatformSubscription[]> {
    return this.platformSubscriptionRepository
      .createQueryBuilder('ps')
      .where('ps.userId = :userId', { userId })
      .andWhere('ps.status IN (:...statuses)', { statuses: ['active', 'trialing', 'past_due'] })
      .orderBy('ps.platform', 'ASC')
      .getMany();
  }

  async updatePlatformSubscription(
    id: number,
    updates: Partial<PlatformSubscription>,
  ): Promise<PlatformSubscription | null> {
    await this.platformSubscriptionRepository.update(id, updates);
    return this.platformSubscriptionRepository.findOneBy({ id });
  }

  async updatePlatformSubscriptionByStripeId(
    stripeSubscriptionId: string,
    updates: Partial<PlatformSubscription>,
  ): Promise<PlatformSubscription | null> {
    await this.platformSubscriptionRepository.update({ stripeSubscriptionId }, updates);
    return this.platformSubscriptionRepository.findOneBy({ stripeSubscriptionId });
  }

  async cancelPlatformSubscription(id: number, cancelAtPeriodEnd: boolean = true): Promise<PlatformSubscription | null> {
    const updates: Partial<PlatformSubscription> = cancelAtPeriodEnd
      ? { cancelAtPeriodEnd: true }
      : { status: 'canceled' };

    await this.platformSubscriptionRepository.update(id, updates);
    return this.platformSubscriptionRepository.findOneBy({ id });
  }

  // ==================== PLATFORM SEATS ====================

  async addPlatformSeat(data: {
    subscriptionId: number;
    userId: number;
    platform: AdPlatform;
    adAccountId: string;
    adAccountName?: string;
  }): Promise<PlatformSeat> {
    const seat = this.platformSeatRepository.create({
      ...data,
      status: 'active',
      addedAt: new Date(),
    });
    return this.platformSeatRepository.save(seat);
  }

  async getPlatformSeats(subscriptionId: number): Promise<PlatformSeat[]> {
    return this.platformSeatRepository.find({
      where: { subscriptionId, status: 'active' },
      order: { addedAt: 'ASC' },
    });
  }

  async getPlatformSeatsByUser(userId: number, platform?: AdPlatform): Promise<PlatformSeat[]> {
    const where: any = { userId, status: 'active' };
    if (platform) {
      where.platform = platform;
    }
    return this.platformSeatRepository.find({
      where,
      relations: ['subscription'],
      order: { platform: 'ASC', addedAt: 'ASC' },
    });
  }

  async getPlatformSeat(subscriptionId: number, adAccountId: string): Promise<PlatformSeat | null> {
    return this.platformSeatRepository.findOneBy({ subscriptionId, adAccountId });
  }

  async removePlatformSeat(subscriptionId: number, adAccountId: string): Promise<void> {
    await this.platformSeatRepository.update(
      { subscriptionId, adAccountId },
      { status: 'inactive', removedAt: new Date() },
    );
  }

  async countActiveSeats(subscriptionId: number): Promise<number> {
    return this.platformSeatRepository.count({
      where: { subscriptionId, status: 'active' },
    });
  }

  // ==================== UTILITY METHODS ====================

  async hasActivePlatformSubscription(userId: number, platform: AdPlatform): Promise<boolean> {
    const subscription = await this.getPlatformSubscription(userId, platform);
    return !!subscription;
  }

  async canAddMoreSeats(subscriptionId: number): Promise<boolean> {
    const subscription = await this.platformSubscriptionRepository.findOneBy({ id: subscriptionId });
    if (!subscription) return false;

    const currentSeats = await this.countActiveSeats(subscriptionId);
    return currentSeats < subscription.quantity;
  }

  async getPlatformUsageSummary(userId: number): Promise<{
    platform: AdPlatform;
    hasSubscription: boolean;
    status?: string;
    planName?: string;
    seatCount?: number;
    seatLimit?: number;
  }[]> {
    const platforms = Object.values(AdPlatform);
    const subscriptions = await this.getActivePlatformSubscriptions(userId);

    return Promise.all(
      platforms.map(async (platform) => {
        const subscription = subscriptions.find((s) => s.platform === platform);
        
        if (!subscription) {
          return { platform, hasSubscription: false };
        }

        const seatCount = await this.countActiveSeats(subscription.id);

        return {
          platform,
          hasSubscription: true,
          status: subscription.status,
          planName: subscription.planName,
          seatCount,
          seatLimit: subscription.quantity,
        };
      }),
    );
  }
}
