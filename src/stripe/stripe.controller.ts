import { Controller, Post, Body, Headers, Req, BadRequestException, UseGuards } from '@nestjs/common';
import { StripeService } from './stripe.service';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import type { Request } from 'express';

@Controller('stripe')
export class StripeController {
  constructor(
    private readonly stripeService: StripeService,
    private readonly configService: ConfigService,
    private readonly subscriptionsService: SubscriptionsService,
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
}

