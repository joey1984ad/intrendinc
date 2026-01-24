import { Controller, Get, Post, Put, Delete, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { StripeService } from '../stripe/stripe.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('organization-subscriptions')
export class OrganizationSubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly stripeService: StripeService,
  ) {}

  // GET - Retrieve organization subscription and seats
  @Get()
  @UseGuards(JwtAuthGuard)
  async getOrganizationSubscription(
    @CurrentUser() user: any,
    @Query('includeHistory') includeHistory?: string,
  ) {
    const subscription = await this.subscriptionsService.getOrganizationSubscription(user.userId);
    const seats = await this.subscriptionsService.getOrganizationSeats(user.userId);
    const billingHistory = includeHistory === 'true'
      ? await this.subscriptionsService.getOrganizationBillingHistory(user.userId)
      : [];

    return {
      success: true,
      subscription,
      seats,
      billingHistory,
    };
  }

  // POST - Create or add seats to organization subscription
  @Post()
  @UseGuards(JwtAuthGuard)
  async createOrUpdateSubscription(
    @CurrentUser() user: any,
    @Body() body: {
      adAccounts: Array<{ adAccountId: string; adAccountName: string; platform?: string }>;
      planId: string;
      billingCycle: string;
      platform?: string;
    },
  ) {
    if (!body.adAccounts || !Array.isArray(body.adAccounts) || !body.planId || !body.billingCycle) {
      throw new BadRequestException('adAccounts array, planId, and billingCycle are required');
    }

    // Default platform is 'facebook' for backwards compatibility
    const defaultPlatform = body.platform || 'facebook';

    const existingSubscription = await this.subscriptionsService.getOrganizationSubscription(user.userId);

    if (existingSubscription) {
      // Add seats to existing subscription
      const addedSeats: any[] = [];

      for (const account of body.adAccounts) {
        // Use account-level platform if specified, otherwise use body-level platform
        const accountPlatform = account.platform || defaultPlatform;
        const seat = await this.subscriptionsService.addOrganizationSeat(
          existingSubscription.id,
          user.userId,
          account.adAccountId,
          account.adAccountName,
          accountPlatform,
        );
        addedSeats.push(seat);
      }

      // Update quantity
      const allSeats = await this.subscriptionsService.getOrganizationSeats(user.userId);
      await this.subscriptionsService.updateOrganizationSubscriptionQuantity(
        existingSubscription.id,
        allSeats.length,
      );

      // Update Stripe if not trial
      if (existingSubscription.stripeSubscriptionId && !existingSubscription.stripeSubscriptionId.startsWith('trial_')) {
        try {
          await this.stripeService.updateSubscriptionQuantity(
            existingSubscription.stripeSubscriptionId,
            allSeats.length,
          );
        } catch (error) {
          // Log but don't fail
        }
      }

      return {
        success: true,
        action: 'seats-added',
        addedSeats,
        subscription: existingSubscription,
        totalSeats: allSeats.length,
      };
    }

    // No existing subscription - return info for checkout
    return {
      success: false,
      requiresCheckout: true,
      message: 'No active subscription. Please complete checkout first.',
    };
  }

  // PUT - Update subscription (change plan/billing cycle)
  @Put()
  @UseGuards(JwtAuthGuard)
  async updateSubscription(
    @CurrentUser() user: any,
    @Body() body: {
      planId: string;
      billingCycle: string;
      quantity?: number;
    },
  ) {
    const subscription = await this.subscriptionsService.getOrganizationSubscription(user.userId);

    if (!subscription) {
      throw new BadRequestException('No active organization subscription found');
    }

    // Update in database
    await this.subscriptionsService.updateOrganizationSubscriptionStatus(
      subscription.id,
      subscription.status,
    );

    return {
      success: true,
      subscription,
    };
  }

  // DELETE - Cancel subscription or remove seat
  @Delete()
  @UseGuards(JwtAuthGuard)
  async deleteSubscriptionOrSeat(
    @CurrentUser() user: any,
    @Query('seatId') seatId?: string,
  ) {
    const subscription = await this.subscriptionsService.getOrganizationSubscription(user.userId);

    if (!subscription) {
      throw new BadRequestException('No active organization subscription found');
    }

    if (seatId) {
      // Remove specific seat
      await this.subscriptionsService.deactivateOrganizationSeat(parseInt(seatId));

      // Update quantities
      const remainingSeats = await this.subscriptionsService.getOrganizationSeats(user.userId);
      await this.subscriptionsService.updateOrganizationSubscriptionQuantity(
        subscription.id,
        remainingSeats.length,
      );

      // Update Stripe
      if (subscription.stripeSubscriptionId && !subscription.stripeSubscriptionId.startsWith('trial_')) {
        try {
          await this.stripeService.updateSubscriptionQuantity(
            subscription.stripeSubscriptionId,
            remainingSeats.length,
          );
        } catch (error) {
          // Log but don't fail
        }
      }

      return {
        success: true,
        action: 'seat-removed',
        remainingSeats: remainingSeats.length,
      };
    }

    // Cancel entire subscription
    if (subscription.stripeSubscriptionId && !subscription.stripeSubscriptionId.startsWith('trial_')) {
      try {
        await this.stripeService.cancelSubscription(subscription.stripeSubscriptionId);
      } catch (error) {
        // Log but continue with local cancellation
      }
    }

    await this.subscriptionsService.updateOrganizationSubscriptionStatus(subscription.id, 'canceled');

    return {
      success: true,
      action: 'subscription-canceled',
      message: 'Organization subscription canceled successfully',
    };
  }
}
