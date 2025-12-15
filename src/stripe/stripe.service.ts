import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';

@Injectable()
export class StripeService implements OnModuleInit {
  private stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    private subscriptionsService: SubscriptionsService,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('stripe.secretKey') || '', {
      apiVersion: '2024-12-18.acacia' as any,
    });
  }

  onModuleInit() {
    // Optional: Check connection or log initialization
  }

  getStripeClient() {
    return this.stripe;
  }

  async createCheckoutSession(params: {
    customerId: string;
    priceId: string;
    quantity?: number;
    successUrl: string;
    cancelUrl: string;
    mode?: 'payment' | 'subscription';
    metadata?: Record<string, string>;
    subscriptionData?: Stripe.Checkout.SessionCreateParams.SubscriptionData;
    allowPromotionCodes?: boolean;
  }) {
    return this.stripe.checkout.sessions.create({
      customer: params.customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: params.priceId,
          quantity: params.quantity || 1,
        },
      ],
      mode: params.mode || 'subscription',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
      subscription_data: params.subscriptionData,
      allow_promotion_codes: params.allowPromotionCodes ?? true,
      billing_address_collection: 'required',
    });
  }

  async createCustomerPortalSession(customerId: string, returnUrl: string) {
    return this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async createCustomer(email: string, name?: string) {
    return this.stripe.customers.create({
      email,
      name,
    });
  }

  async getCustomerByEmail(email: string) {
    const customers = await this.stripe.customers.list({
      email,
      limit: 1,
    });
    return customers.data[0] || null;
  }

  async createProrationCoupon(amountOff: number) {
    const couponId = `proration_${Date.now()}`;
    return this.stripe.coupons.create({
      id: couponId,
      amount_off: Math.floor(amountOff), // Ensure integer
      currency: 'usd',
      duration: 'once',
      name: `Proration Credit - $${(amountOff / 100).toFixed(2)}`,
      metadata: {
        type: 'proration_credit',
        amount_off: amountOff.toString(),
      },
    });
  }

  async constructEventFromPayload(signature: string, payload: Buffer) {
    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');
    if (!webhookSecret) {
      throw new Error('Stripe webhook secret is not configured');
    }
    return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  }

  async handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
    const { metadata } = session;

    if (!metadata || !metadata.userId) {
      this.logger.warn('Webhook: Missing userId in metadata');
      return;
    }

    const userId = parseInt(metadata.userId);
    const planId = metadata.planId;
    const billingCycle = metadata.billingCycle;
    const subscriptionType = metadata.type || 'per_account';

    if (isNaN(userId)) {
      this.logger.warn(`Webhook: Invalid userId ${metadata.userId}`);
      return;
    }

    let adAccountIds: string[] = [];
    let adAccountNames: string[] = [];
    try {
      adAccountIds = JSON.parse(metadata.adAccountIds || '[]');
      adAccountNames = JSON.parse(metadata.adAccountNames || '[]');
    } catch (parseError) {
      this.logger.warn('Webhook: Failed to parse adAccountIds/Names');
    }

    if (!session.subscription) {
      return;
    }

    const subscriptionData = await this.stripe.subscriptions.retrieve(session.subscription as string, {
      expand: [
        'latest_invoice',
        'items.data.price.product',
        'default_payment_method',
        'latest_invoice.payment_intent.payment_method',
        'latest_invoice.default_payment_method',
      ],
    });
    const subscription = subscriptionData as unknown as { id: string; current_period_start: number; current_period_end: number; status: string };

    const currentPeriodStart = new Date(subscription.current_period_start * 1000);
    const currentPeriodEnd = new Date(subscription.current_period_end * 1000);

    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Webhook: User not found ${userId}`);
      return;
    }

    const normalizedBillingCycle = billingCycle === 'annual' ? 'annual' : 'monthly';
    const resolvedPlanName = metadata.planName || (planId ? planId.toString().split('_').map((p: string) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') : 'Paid');
    
    await this.usersService.update(userId, {
      currentPlanId: planId || 'unknown',
      currentPlanName: resolvedPlanName,
      currentBillingCycle: normalizedBillingCycle,
      subscriptionStatus: subscription.status,
    });

    if (subscriptionType === 'organization') {
      const quantity = parseInt(metadata.quantity || '0') || adAccountIds.length;
      const planName = metadata.planName || `${planId} Plan`;

      const orgSub = await this.subscriptionsService.createOrganizationSubscription({
        userId,
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: session.customer as string,
        planId,
        planName,
        billingCycle: normalizedBillingCycle,
        quantity,
        currentPeriodStart,
        currentPeriodEnd,
        status: subscription.status,
      });

      for (let i = 0; i < adAccountIds.length; i++) {
        try {
          await this.subscriptionsService.addOrganizationSeat(
            orgSub.id,
            userId,
            adAccountIds[i],
            adAccountNames[i] || '',
          );
        } catch (e) {
          this.logger.error(`Webhook: Failed to add seat for ${adAccountIds[i]}`, e);
        }
      }
    }
  }

  async handleInvoicePaymentSucceeded(invoice: Stripe.Invoice) {
    // No implementation in legacy system
    const inv = invoice as any;
    const subscriptionId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
    
    if (subscriptionId) {
      // Placeholder for future implementation
    }
  }

  async handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
    // No implementation in legacy system
  }

  async deletePaymentMethod(paymentMethodId: string): Promise<void> {
    await this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async getPaymentMethods(customerId: string): Promise<Stripe.PaymentMethod[]> {
    const methods = await this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    return methods.data;
  }

  async cancelSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
    return this.stripe.subscriptions.cancel(subscriptionId);
  }

  async updateSubscriptionQuantity(
    subscriptionId: string,
    quantity: number,
    prorationBehavior: 'always_invoice' | 'create_prorations' | 'none' = 'always_invoice'
  ): Promise<Stripe.Subscription> {
    const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
    const itemId = subscription.items.data[0]?.id;
    
    if (!itemId) {
      throw new Error('No subscription item found');
    }

    return this.stripe.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, quantity }],
      proration_behavior: prorationBehavior,
    });
  }
}

