import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { UsersService } from '../users/users.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { PlatformSubscriptionsService } from '../subscriptions/platform-subscriptions.service';
import { AdPlatform } from '../common/interfaces/ad-platform.interface';
import { stripeSpecialUsersConfig } from '../config/stripe-special-users.config';

@Injectable()
export class StripeService implements OnModuleInit {
  private stripe: Stripe;
  private readonly logger = new Logger(StripeService.name);

  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    private subscriptionsService: SubscriptionsService,
    private platformSubscriptionsService: PlatformSubscriptionsService,
  ) {
    this.stripe = new Stripe(this.configService.get<string>('stripe.secretKey') || '', {
      apiVersion: '2024-12-18.acacia' as any,
    });
  }

  getClient(email?: string): Stripe {
    // Check if the email corresponds to a special user configuration
    if (email && stripeSpecialUsersConfig[email]) {
      const specialConfig = stripeSpecialUsersConfig[email];
      return new Stripe(specialConfig.secretKey, {
        apiVersion: '2024-12-18.acacia' as any,
      });
    }
    return this.stripe;
  }

  private getSpecialConfig(email?: string) {
    if (email && stripeSpecialUsersConfig[email]) {
      return stripeSpecialUsersConfig[email];
    }
    return null;
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
    email?: string;
  }) {
    const stripeClient = this.getClient(params.email);
    return stripeClient.checkout.sessions.create({
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

  async createCustomerPortalSession(customerId: string, returnUrl: string, email?: string) {
    const stripeClient = this.getClient(email);
    return stripeClient.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  async createCustomer(email: string, name?: string) {
    const stripeClient = this.getClient(email);
    return stripeClient.customers.create({
      email,
      name,
    });
  }

  async getCustomerByEmail(email: string) {
    const stripeClient = this.getClient(email);
    const customers = await stripeClient.customers.list({
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
    // Try standard webhook secret first
    const webhookSecret = this.configService.get<string>('stripe.webhookSecret');
    
    if (webhookSecret) {
      try {
        return this.stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } catch (err) {
        // If standard secret fails, try special user secrets
        for (const [email, config] of Object.entries(stripeSpecialUsersConfig)) {
          if (config.webhookSecret) {
            try {
              const specialClient = this.getClient(email);
              return specialClient.webhooks.constructEvent(payload, signature, config.webhookSecret);
            } catch (e) {
               // Continue to next secret
            }
          }
        }
        throw err; // Throw original error if none match
      }
    } else {
        throw new Error('Stripe webhook secret is not configured');
    }
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

    // Retrieve user to get email for correct Stripe client
    const user = await this.usersService.findOne(userId);
    if (!user) {
      this.logger.warn(`Webhook: User not found ${userId}`);
      return;
    }
    
    const stripeClient = this.getClient(user.email);

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

    const subscriptionData = await stripeClient.subscriptions.retrieve(session.subscription as string, {
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
    
    // User already fetched above


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

    // Handle platform-specific subscriptions (Google Ads, TikTok, etc.)
    if (subscriptionType === 'platform') {
      const platform = metadata.platform as AdPlatform;
      const quantity = parseInt(metadata.quantity || '1');
      const planName = metadata.planName || `${platform} ${planId} Plan`;

      if (!platform || !Object.values(AdPlatform).includes(platform)) {
        this.logger.warn(`Webhook: Invalid or missing platform: ${platform}`);
        return;
      }

      const platformSub = await this.platformSubscriptionsService.createPlatformSubscription({
        userId,
        platform,
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

      // Add ad accounts as seats if provided
      for (let i = 0; i < adAccountIds.length; i++) {
        try {
          await this.platformSubscriptionsService.addPlatformSeat({
            subscriptionId: platformSub.id,
            userId,
            platform,
            adAccountId: adAccountIds[i],
            adAccountName: adAccountNames[i] || '',
          });
        } catch (e) {
          this.logger.error(`Webhook: Failed to add platform seat for ${adAccountIds[i]}`, e);
        }
      }

      this.logger.log(`Platform subscription created: ${platform} for user ${userId}`);
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

  // ==================== PLATFORM SUBSCRIPTIONS ====================

  /**
   * Create a platform-specific checkout session (Google Ads, TikTok, etc.)
   */

  async createPlatformCheckoutSession(params: {
    userId: number;
    email: string;
    platform: AdPlatform;
    planId: string;
    planName: string;
    priceId: string;
    quantity?: number;
    billingCycle: 'monthly' | 'annual';
    successUrl: string;
    cancelUrl: string;
    adAccountIds?: string[];
    adAccountNames?: string[];
  }): Promise<Stripe.Checkout.Session> {
    const stripeClient = this.getClient(params.email);
    // Get or create customer
    let customer = await this.getCustomerByEmail(params.email);
    if (!customer) {
      customer = await this.createCustomer(params.email);
    }

    return stripeClient.checkout.sessions.create({
      customer: customer.id,
      payment_method_types: ['card'],
      line_items: [
        {
          price: params.priceId,
          quantity: params.quantity || 1,
        },
      ],
      mode: 'subscription',
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: {
        type: 'platform',
        userId: params.userId.toString(),
        platform: params.platform,
        planId: params.planId,
        planName: params.planName,
        billingCycle: params.billingCycle,
        quantity: (params.quantity || 1).toString(),
        adAccountIds: JSON.stringify(params.adAccountIds || []),
        adAccountNames: JSON.stringify(params.adAccountNames || []),
      },
      subscription_data: {
        metadata: {
          type: 'platform',
          userId: params.userId.toString(),
          platform: params.platform,
          planId: params.planId,
        },
      },
      allow_promotion_codes: true,
      billing_address_collection: 'required',
    });
  }

  /**
   * Get platform-specific price IDs
   */
  getPlatformPriceIds(platform: AdPlatform, billingCycle: 'monthly' | 'annual', email?: string): {
    starter: string | undefined;
    pro: string | undefined;
  } {
    const config = this.configService.get('stripe');
    const specialConfig = this.getSpecialConfig(email);

    switch (platform) {
      case AdPlatform.GOOGLE:
        if (specialConfig) {
             // We don't have special config for Google Ads yet in the hardcoded list, 
             // but we will use the standard logic structure.
             // If we had google ads keys in special config:
             // return {
             //   starter: billingCycle === 'monthly' ? specialConfig.googleAdsStarterMonthlyPriceId : ...
             // }
             // Fallback to standard for now as they were not in the requirement list explicitly?
             // Actually, I should check if I missed them. The task said "fetch all stripe data from .env.dev".
             // The .env.dev does NOT seem to have specific Google Ads price IDs in the section I copied.
             // Wait, I saw GOOGLE_ADS... env vars but for Stripe Price IDs?
             // Checking .env.dev again...
             // It calls: STRIPE_TIKTOK_... and STRIPE_ORGANIZATION_...
             // It does NOT explicitly show STRIPE_GOOGLE_ADS_... in the file snippet I saw.
             // So I will only override what I have.
        }
        return {
          starter: billingCycle === 'monthly' 
            ? config?.googleAdsStarterMonthlyPriceId 
            : config?.googleAdsStarterAnnualPriceId,
          pro: billingCycle === 'monthly' 
            ? config?.googleAdsProMonthlyPriceId 
            : config?.googleAdsProAnnualPriceId,
        };
      case AdPlatform.TIKTOK:
        if (specialConfig) {
             return {
                starter: billingCycle === 'monthly' ? specialConfig.tiktokStarterMonthlyPriceId : specialConfig.tiktokStarterAnnualPriceId,
                pro: billingCycle === 'monthly' ? specialConfig.tiktokProMonthlyPriceId : specialConfig.tiktokProAnnualPriceId,
             }
        }
        return {
          starter: billingCycle === 'monthly' 
            ? config?.tiktokStarterMonthlyPriceId 
            : config?.tiktokStarterAnnualPriceId,
          pro: billingCycle === 'monthly' 
            ? config?.tiktokProMonthlyPriceId 
            : config?.tiktokProAnnualPriceId,
        };
      default:
        return { starter: undefined, pro: undefined };
    }
  }

  getOrganizationPriceIds(billingCycle: 'monthly' | 'annual', email?: string): {
    basic: string | undefined;
    pro: string | undefined;
  } {
    const config = this.configService.get('stripe');
    const specialConfig = this.getSpecialConfig(email);

    if (specialConfig) {
      return {
        basic: billingCycle === 'monthly' ? specialConfig.organizationBasicMonthlyPriceId : specialConfig.organizationBasicAnnualPriceId,
        pro: billingCycle === 'monthly' ? specialConfig.organizationProMonthlyPriceId : specialConfig.organizationProAnnualPriceId,
      };
    }

    return {
      basic: billingCycle === 'monthly' 
        ? config?.organizationBasicMonthlyPriceId 
        : config?.organizationBasicAnnualPriceId,
      pro: billingCycle === 'monthly' 
        ? config?.organizationProMonthlyPriceId 
        : config?.organizationProAnnualPriceId,
    };
  }

  /**
   * Handle subscription.updated webhook for platform subscriptions
   */
  async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    const metadata = subscription.metadata;
    
    if (metadata?.type !== 'platform') {
      return;
    }

    const platform = metadata.platform as AdPlatform;
    if (!platform) return;

    const sub = subscription as any;
    const currentPeriodStart = new Date(sub.current_period_start * 1000);
    const currentPeriodEnd = new Date(sub.current_period_end * 1000);

    await this.platformSubscriptionsService.updatePlatformSubscriptionByStripeId(
      subscription.id,
      {
        status: subscription.status,
        currentPeriodStart,
        currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      },
    );

    this.logger.log(`Platform subscription updated: ${subscription.id} for ${platform}`);
  }

  /**
   * Handle subscription.deleted webhook for platform subscriptions
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const metadata = subscription.metadata;
    
    if (metadata?.type !== 'platform') {
      return;
    }

    await this.platformSubscriptionsService.updatePlatformSubscriptionByStripeId(
      subscription.id,
      { status: 'canceled' },
    );

    this.logger.log(`Platform subscription canceled: ${subscription.id}`);
  }

  /**
   * Cancel a platform subscription
   */
  async cancelPlatformSubscription(
    userId: number,
    platform: AdPlatform,
    cancelImmediately: boolean = false,
  ): Promise<{ success: boolean; error?: string }> {
    const user = await this.usersService.findOne(userId);
    const stripeClient = this.getClient(user?.email);

    const subscription = await this.platformSubscriptionsService.getPlatformSubscription(userId, platform);
    
    if (!subscription) {
      return { success: false, error: 'No active subscription found' };
    }

    if (!subscription.stripeSubscriptionId) {
      return { success: false, error: 'No Stripe subscription ID found' };
    }

    try {
      if (cancelImmediately) {
        await stripeClient.subscriptions.cancel(subscription.stripeSubscriptionId);
        await this.platformSubscriptionsService.updatePlatformSubscription(subscription.id, {
          status: 'canceled',
        });
      } else {
        await stripeClient.subscriptions.update(subscription.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
        await this.platformSubscriptionsService.updatePlatformSubscription(subscription.id, {
          cancelAtPeriodEnd: true,
        });
      }

      return { success: true };
    } catch (error: any) {
      this.logger.error(`Failed to cancel platform subscription: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
}

