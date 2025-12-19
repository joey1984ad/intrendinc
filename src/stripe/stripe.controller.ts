import { Controller, Post, Body, Headers, Req, BadRequestException, UseGuards, Get, Param } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlatformSubscriptionsService } from '../subscriptions/platform-subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AdPlatform } from '../common/interfaces/ad-platform.interface';
import type { Request } from 'express';

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly platformSubscriptionsService: PlatformSubscriptionsService,
  ) {}

  @Post('create-checkout-session')
  @UseGuards(JwtAuthGuard)
  async createCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: { 
      priceId: string; 
      quantity?: number; 
      metadata?: any; 
      successUrl: string; 
      cancelUrl: string; 
      mode?: 'payment' | 'subscription';
      allowPromotionCodes?: boolean;
    },
  ) {
    let stripeCustomer = await this.subscriptionsService.getStripeCustomer(user.id);
    let customerId = stripeCustomer?.stripeCustomerId;

    if (!customerId) {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const customer = await this.stripeService.createCustomer(user.email, name);
      customerId = customer.id;
      await this.subscriptionsService.createStripeCustomer(user.id, customerId, user.email);
    }

    const session = await this.stripeService.createCheckoutSession({
      customerId,
      priceId: body.priceId,
      quantity: body.quantity,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      mode: body.mode,
      metadata: { ...body.metadata, userId: user.id.toString() },
      allowPromotionCodes: body.allowPromotionCodes,
    });

    return { sessionId: session.id, url: session.url };
  }

  @Post('create-organization-checkout-session')
  @UseGuards(JwtAuthGuard)
  async createOrganizationCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: { 
      priceId: string; 
      quantity: number; 
      metadata?: any; 
      successUrl: string; 
      cancelUrl: string;
    },
  ) {
    let stripeCustomer = await this.subscriptionsService.getStripeCustomer(user.id);
    let customerId = stripeCustomer?.stripeCustomerId;

    if (!customerId) {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const customer = await this.stripeService.createCustomer(user.email, name);
      customerId = customer.id;
      await this.subscriptionsService.createStripeCustomer(user.id, customerId, user.email);
    }

    const session = await this.stripeService.createCheckoutSession({
      customerId,
      priceId: body.priceId,
      quantity: body.quantity,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
      mode: 'subscription',
      metadata: { 
        ...body.metadata, 
        userId: user.id.toString(),
        type: 'organization',
      },
    });

    return { sessionId: session.id, url: session.url };
  }

  @Post('customer-portal')
  @UseGuards(JwtAuthGuard)
  async createCustomerPortal(
    @CurrentUser() user: User,
    @Body() body: { returnUrl: string },
  ) {
    let stripeCustomer = await this.subscriptionsService.getStripeCustomer(user.id);
    let customerId = stripeCustomer?.stripeCustomerId;

    if (!customerId) {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const customer = await this.stripeService.createCustomer(user.email, name);
      customerId = customer.id;
      await this.subscriptionsService.createStripeCustomer(user.id, customerId, user.email);
    }

    const session = await this.stripeService.createCustomerPortalSession(customerId, body.returnUrl);

    return { url: session.url };
  }

  @Post('webhook')
  async handleWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signature: string,
  ) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');
    if (!webhookSecret) {
        throw new Error('Stripe webhook secret is not configured');
    }

    try {
      const rawBody = (req as any).rawBody;
      if (!rawBody) {
        throw new BadRequestException('Raw body not available');
      }

      const event = this.stripeService.getStripeClient().webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      );

      // Handle the event
      switch (event.type) {
        case 'checkout.session.completed':
          await this.stripeService.handleCheckoutSessionCompleted(event.data.object as any);
          break;
        case 'invoice.payment_succeeded':
          await this.stripeService.handleInvoicePaymentSucceeded(event.data.object as any);
          break;
        case 'customer.subscription.updated':
          await this.stripeService.handleSubscriptionUpdated(event.data.object as any);
          break;
        case 'customer.subscription.deleted':
          await this.stripeService.handleSubscriptionDeleted(event.data.object as any);
          break;
        default:
          console.log(`Unhandled event type ${event.type}`);
      }

      return { received: true };
    } catch (err: any) {
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }
  }

  @Post('create-bulk-upgrade-checkout-session')
  @UseGuards(JwtAuthGuard)
  async createBulkUpgradeCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: {
      adAccounts: Array<{ id: string; name: string }>;
      planId: string;
      billingCycle: string;
      successUrl?: string;
      cancelUrl?: string;
    },
  ) {
    if (!body.adAccounts || !Array.isArray(body.adAccounts) || body.adAccounts.length === 0) {
      throw new BadRequestException('adAccounts array is required');
    }

    if (!body.planId || !body.billingCycle) {
      throw new BadRequestException('planId and billingCycle are required');
    }

    let stripeCustomer = await this.subscriptionsService.getStripeCustomer(user.id);
    let customerId = stripeCustomer?.stripeCustomerId;

    if (!customerId) {
      const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
      const customer = await this.stripeService.createCustomer(user.email, name);
      customerId = customer.id;
      await this.subscriptionsService.createStripeCustomer(user.id, customerId, user.email);
    }

    // Get the price ID from environment
    const priceMap: Record<string, Record<string, string | undefined>> = {
      basic: {
        monthly: this.configService.get<string>('stripe.organizationBasicMonthlyPriceId'),
        annual: this.configService.get<string>('stripe.organizationBasicAnnualPriceId'),
      },
      pro: {
        monthly: this.configService.get<string>('stripe.organizationProMonthlyPriceId'),
        annual: this.configService.get<string>('stripe.organizationProAnnualPriceId'),
      },
    };

    const priceId = priceMap[body.planId]?.[body.billingCycle];
    if (!priceId) {
      throw new BadRequestException('Invalid plan or billing cycle');
    }

    const baseUrl = this.configService.get<string>('app.frontendUrl') || 'http://localhost:3000';
    const successUrl = body.successUrl || `${baseUrl}/billing?upgrade=success`;
    const cancelUrl = body.cancelUrl || `${baseUrl}/billing?upgrade=canceled`;

    const session = await this.stripeService.createCheckoutSession({
      customerId,
      priceId,
      quantity: body.adAccounts.length,
      successUrl,
      cancelUrl,
      mode: 'subscription',
      metadata: {
        userId: user.id.toString(),
        planId: body.planId,
        billingCycle: body.billingCycle,
        accountCount: body.adAccounts.length.toString(),
        type: 'bulk_upgrade',
        adAccountIds: JSON.stringify(body.adAccounts.map(a => a.id)),
        adAccountNames: JSON.stringify(body.adAccounts.map(a => a.name)),
      },
      allowPromotionCodes: true,
    });

    return {
      success: true,
      sessionId: session.id,
      url: session.url,
      metadata: {
        accountCount: body.adAccounts.length,
        planId: body.planId,
        billingCycle: body.billingCycle,
      },
    };
  }

  // ==================== PLATFORM SUBSCRIPTIONS ====================

  /**
   * Create a platform-specific checkout session (Google Ads, TikTok, etc.)
   */
  @Post('create-platform-checkout-session')
  @UseGuards(JwtAuthGuard)
  async createPlatformCheckoutSession(
    @CurrentUser() user: User,
    @Body() body: {
      platform: string;
      planId: string;
      billingCycle: 'monthly' | 'annual';
      quantity?: number;
      adAccountIds?: string[];
      adAccountNames?: string[];
      successUrl?: string;
      cancelUrl?: string;
    },
  ) {
    // Validate platform
    const platform = body.platform.toLowerCase() as AdPlatform;
    if (!Object.values(AdPlatform).includes(platform)) {
      throw new BadRequestException(`Invalid platform: ${body.platform}`);
    }

    if (!body.planId || !body.billingCycle) {
      throw new BadRequestException('planId and billingCycle are required');
    }

    // Get price IDs for the platform
    const priceIds = this.stripeService.getPlatformPriceIds(platform, body.billingCycle);
    const priceId = body.planId === 'starter' ? priceIds.starter : priceIds.pro;

    if (!priceId) {
      throw new BadRequestException(`No price configured for ${platform} ${body.planId} ${body.billingCycle}`);
    }

    const baseUrl = this.configService.get<string>('app.frontendUrl') || 'http://localhost:3000';
    const platformPath = platform === AdPlatform.GOOGLE ? 'google-ads' : platform;
    const successUrl = body.successUrl || `${baseUrl}/${platformPath}?subscription=success`;
    const cancelUrl = body.cancelUrl || `${baseUrl}/${platformPath}?subscription=canceled`;

    const planName = `${platform.charAt(0).toUpperCase() + platform.slice(1)} ${body.planId.charAt(0).toUpperCase() + body.planId.slice(1)}`;

    const session = await this.stripeService.createPlatformCheckoutSession({
      userId: user.id,
      email: user.email,
      platform,
      planId: body.planId,
      planName,
      priceId,
      quantity: body.quantity || 1,
      billingCycle: body.billingCycle,
      successUrl,
      cancelUrl,
      adAccountIds: body.adAccountIds,
      adAccountNames: body.adAccountNames,
    });

    return {
      success: true,
      sessionId: session.id,
      url: session.url,
    };
  }

  /**
   * Get platform subscription status
   */
  @Get('platform-subscription/:platform')
  @UseGuards(JwtAuthGuard)
  async getPlatformSubscription(
    @CurrentUser() user: User,
    @Param('platform') platformParam: string,
  ) {
    const platform = platformParam.toLowerCase() as AdPlatform;
    if (!Object.values(AdPlatform).includes(platform)) {
      throw new BadRequestException(`Invalid platform: ${platformParam}`);
    }

    const subscription = await this.platformSubscriptionsService.getPlatformSubscription(user.id, platform);
    
    if (!subscription) {
      return { success: true, hasSubscription: false };
    }

    const seats = await this.platformSubscriptionsService.getPlatformSeats(subscription.id);
    const canAddMoreSeats = await this.platformSubscriptionsService.canAddMoreSeats(subscription.id);

    return {
      success: true,
      hasSubscription: true,
      subscription: {
        id: subscription.id,
        platform: subscription.platform,
        planId: subscription.planId,
        planName: subscription.planName,
        status: subscription.status,
        quantity: subscription.quantity,
        billingCycle: subscription.billingCycle,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      seats: seats.map(s => ({
        adAccountId: s.adAccountId,
        adAccountName: s.adAccountName,
        addedAt: s.addedAt,
      })),
      canAddMoreSeats,
    };
  }

  /**
   * Cancel a platform subscription
   */
  @Post('cancel-platform-subscription')
  @UseGuards(JwtAuthGuard)
  async cancelPlatformSubscription(
    @CurrentUser() user: User,
    @Body() body: { platform: string; cancelImmediately?: boolean },
  ) {
    const platform = body.platform.toLowerCase() as AdPlatform;
    if (!Object.values(AdPlatform).includes(platform)) {
      throw new BadRequestException(`Invalid platform: ${body.platform}`);
    }

    const result = await this.stripeService.cancelPlatformSubscription(
      user.id,
      platform,
      body.cancelImmediately ?? false,
    );

    return result;
  }

  /**
   * Get available platform plans with pricing
   */
  @Get('platform-plans/:platform')
  async getPlatformPlans(@Param('platform') platformParam: string) {
    const platform = platformParam.toLowerCase() as AdPlatform;
    if (!Object.values(AdPlatform).includes(platform)) {
      throw new BadRequestException(`Invalid platform: ${platformParam}`);
    }

    const monthlyPrices = this.stripeService.getPlatformPriceIds(platform, 'monthly');
    const annualPrices = this.stripeService.getPlatformPriceIds(platform, 'annual');

    // Platform-specific plan configurations
    const platformPlans: Record<AdPlatform, { starter: any; pro: any }> = {
      [AdPlatform.GOOGLE]: {
        starter: {
          name: 'Google Ads Starter',
          description: 'Perfect for small businesses',
          features: ['Up to 3 ad accounts', 'Basic metrics dashboard', 'Campaign performance tracking', 'Email support'],
          monthlyPrice: 29,
          annualPrice: 290,
          maxAccounts: 3,
        },
        pro: {
          name: 'Google Ads Pro',
          description: 'For growing agencies',
          features: ['Up to 10 ad accounts', 'Advanced analytics', 'Custom reporting', 'Priority support', 'API access'],
          monthlyPrice: 79,
          annualPrice: 790,
          maxAccounts: 10,
        },
      },
      [AdPlatform.TIKTOK]: {
        starter: {
          name: 'TikTok Starter',
          description: 'Perfect for small businesses',
          features: ['Up to 3 ad accounts', 'Basic metrics dashboard', 'AI creative analysis', 'Email support'],
          monthlyPrice: 29,
          annualPrice: 290,
          maxAccounts: 3,
        },
        pro: {
          name: 'TikTok Pro',
          description: 'For growing agencies',
          features: ['Up to 10 ad accounts', 'Advanced AI analysis', 'Image optimization', 'Priority support'],
          monthlyPrice: 79,
          annualPrice: 790,
          maxAccounts: 10,
        },
      },
      [AdPlatform.FACEBOOK]: {
        starter: { name: 'Facebook Starter', description: '', features: [], monthlyPrice: 29, annualPrice: 290, maxAccounts: 3 },
        pro: { name: 'Facebook Pro', description: '', features: [], monthlyPrice: 79, annualPrice: 790, maxAccounts: 10 },
      },
      [AdPlatform.LINKEDIN]: {
        starter: { name: 'LinkedIn Starter', description: '', features: [], monthlyPrice: 29, annualPrice: 290, maxAccounts: 3 },
        pro: { name: 'LinkedIn Pro', description: '', features: [], monthlyPrice: 79, annualPrice: 790, maxAccounts: 10 },
      },
      [AdPlatform.TWITTER]: {
        starter: { name: 'Twitter Starter', description: '', features: [], monthlyPrice: 29, annualPrice: 290, maxAccounts: 3 },
        pro: { name: 'Twitter Pro', description: '', features: [], monthlyPrice: 79, annualPrice: 790, maxAccounts: 10 },
      },
      [AdPlatform.SNAPCHAT]: {
        starter: { name: 'Snapchat Starter', description: '', features: [], monthlyPrice: 29, annualPrice: 290, maxAccounts: 3 },
        pro: { name: 'Snapchat Pro', description: '', features: [], monthlyPrice: 79, annualPrice: 790, maxAccounts: 10 },
      },
    };

    const plans = platformPlans[platform];

    return {
      success: true,
      platform,
      plans: {
        starter: {
          ...plans.starter,
          priceIds: {
            monthly: monthlyPrices.starter,
            annual: annualPrices.starter,
          },
        },
        pro: {
          ...plans.pro,
          priceIds: {
            monthly: monthlyPrices.pro,
            annual: annualPrices.pro,
          },
        },
      },
    };
  }
}

