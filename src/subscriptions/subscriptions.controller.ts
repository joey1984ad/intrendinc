import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StripeService } from '../stripe/stripe.service';

@Controller('subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly stripeService: StripeService,
  ) {}

  @Get()
  async getSubscription(@CurrentUser() user: any) {
    const subscription = await this.subscriptionsService.getSubscriptionByUserId(user.userId);
    return { success: true, subscription };
  }

  @Get('organization')
  async getOrganizationSubscription(@CurrentUser() user: any) {
    const subscription = await this.subscriptionsService.getOrganizationSubscription(user.userId);
    const seats = await this.subscriptionsService.getOrganizationSeats(user.userId);
    return { success: true, subscription, seats };
  }

  @Get('invoices')
  async getInvoices(@CurrentUser() user: any) {
    const invoices = await this.subscriptionsService.getInvoicesByUserId(user.userId);
    return { success: true, invoices };
  }

  @Get('payment-methods')
  async getPaymentMethods(@CurrentUser() user: any) {
    const paymentMethods = await this.subscriptionsService.getPaymentMethodsByUserId(user.userId);
    return { success: true, paymentMethods };
  }

  @Delete('payment-methods/:id')
  async deletePaymentMethod(
    @Param('id') id: string,
    @CurrentUser() user: any,
  ) {
    const paymentMethods = await this.subscriptionsService.getPaymentMethodsByUserId(user.userId);
    const pm = paymentMethods.find(p => p.id === parseInt(id));
    
    if (!pm) {
      throw new BadRequestException('Payment method not found');
    }

    // Delete from Stripe
    try {
      await this.stripeService.deletePaymentMethod(pm.stripePaymentMethodId);
    } catch (error) {
      // Continue even if Stripe deletion fails
    }

    await this.subscriptionsService.deletePaymentMethod(parseInt(id));
    return { success: true, message: 'Payment method deleted' };
  }

  @Get('verify')
  async verifySubscription(
    @CurrentUser() user: any,
    @Query('sessionId') sessionId?: string,
  ) {
    const subscription = await this.subscriptionsService.getSubscriptionByUserId(user.userId);
    const organizationSub = await this.subscriptionsService.getOrganizationSubscription(user.userId);
    
    return {
      success: true,
      hasActiveSubscription: !!(
        (subscription && ['active', 'trialing'].includes(subscription.status)) ||
        (organizationSub && ['active', 'trialing'].includes(organizationSub.status))
      ),
      subscription,
      organizationSubscription: organizationSub,
    };
  }
}

