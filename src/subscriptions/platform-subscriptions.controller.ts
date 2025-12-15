import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { PlatformSubscriptionsService } from './platform-subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdPlatform } from '../common/interfaces/ad-platform.interface';

@Controller('subscriptions/platform')
@UseGuards(JwtAuthGuard)
export class PlatformSubscriptionsController {
  constructor(
    private readonly platformSubscriptionsService: PlatformSubscriptionsService,
  ) {}

  @Get()
  async getAllPlatformSubscriptions(@CurrentUser() user: any) {
    const subscriptions = await this.platformSubscriptionsService.getAllPlatformSubscriptions(user.userId);
    return { success: true, subscriptions };
  }

  @Get('active')
  async getActivePlatformSubscriptions(@CurrentUser() user: any) {
    const subscriptions = await this.platformSubscriptionsService.getActivePlatformSubscriptions(user.userId);
    return { success: true, subscriptions };
  }

  @Get('summary')
  async getPlatformUsageSummary(@CurrentUser() user: any) {
    const summary = await this.platformSubscriptionsService.getPlatformUsageSummary(user.userId);
    return { success: true, summary };
  }

  @Get(':platform')
  async getPlatformSubscription(
    @CurrentUser() user: any,
    @Param('platform') platform: string,
  ) {
    const adPlatform = this.validatePlatform(platform);
    const subscription = await this.platformSubscriptionsService.getPlatformSubscription(user.userId, adPlatform);
    
    if (!subscription) {
      return { success: false, message: `No active subscription for ${platform}` };
    }

    const seats = await this.platformSubscriptionsService.getPlatformSeats(subscription.id);
    return { success: true, subscription, seats };
  }

  @Get(':platform/seats')
  async getPlatformSeats(
    @CurrentUser() user: any,
    @Param('platform') platform: string,
  ) {
    const adPlatform = this.validatePlatform(platform);
    const seats = await this.platformSubscriptionsService.getPlatformSeatsByUser(user.userId, adPlatform);
    return { success: true, seats };
  }

  @Post(':platform/seats')
  async addPlatformSeat(
    @CurrentUser() user: any,
    @Param('platform') platform: string,
    @Body() body: { adAccountId: string; adAccountName?: string },
  ) {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    const adPlatform = this.validatePlatform(platform);
    const subscription = await this.platformSubscriptionsService.getPlatformSubscription(user.userId, adPlatform);
    
    if (!subscription) {
      throw new BadRequestException(`No active subscription for ${platform}`);
    }

    const canAdd = await this.platformSubscriptionsService.canAddMoreSeats(subscription.id);
    if (!canAdd) {
      throw new BadRequestException('Seat limit reached. Please upgrade your subscription.');
    }

    const existingSeat = await this.platformSubscriptionsService.getPlatformSeat(subscription.id, body.adAccountId);
    if (existingSeat) {
      throw new BadRequestException('This ad account is already added');
    }

    const seat = await this.platformSubscriptionsService.addPlatformSeat({
      subscriptionId: subscription.id,
      userId: user.userId,
      platform: adPlatform,
      adAccountId: body.adAccountId,
      adAccountName: body.adAccountName,
    });

    return { success: true, seat };
  }

  @Delete(':platform/seats/:adAccountId')
  async removePlatformSeat(
    @CurrentUser() user: any,
    @Param('platform') platform: string,
    @Param('adAccountId') adAccountId: string,
  ) {
    const adPlatform = this.validatePlatform(platform);
    const subscription = await this.platformSubscriptionsService.getPlatformSubscription(user.userId, adPlatform);
    
    if (!subscription) {
      throw new BadRequestException(`No active subscription for ${platform}`);
    }

    await this.platformSubscriptionsService.removePlatformSeat(subscription.id, adAccountId);
    return { success: true, message: 'Seat removed successfully' };
  }

  @Get(':platform/can-access/:adAccountId')
  async checkAccess(
    @CurrentUser() user: any,
    @Param('platform') platform: string,
    @Param('adAccountId') adAccountId: string,
  ) {
    const adPlatform = this.validatePlatform(platform);
    const subscription = await this.platformSubscriptionsService.getPlatformSubscription(user.userId, adPlatform);
    
    if (!subscription) {
      return { success: true, hasAccess: false, reason: 'No active subscription' };
    }

    const seat = await this.platformSubscriptionsService.getPlatformSeat(subscription.id, adAccountId);
    
    return {
      success: true,
      hasAccess: !!seat,
      reason: seat ? undefined : 'Ad account not in subscription',
    };
  }

  private validatePlatform(platform: string): AdPlatform {
    const normalizedPlatform = platform.toLowerCase() as AdPlatform;
    
    if (!Object.values(AdPlatform).includes(normalizedPlatform)) {
      throw new BadRequestException(
        `Invalid platform: ${platform}. Valid platforms are: ${Object.values(AdPlatform).join(', ')}`,
      );
    }

    return normalizedPlatform;
  }
}
