import { registerAs } from '@nestjs/config';

export const stripeConfig = registerAs('stripe', () => ({
  secretKey: process.env.STRIPE_SECRET_KEY,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  
  // Price IDs
  startupMonthlyPriceId: process.env.STRIPE_STARTUP_MONTHLY_PRICE_ID,
  startupAnnualPriceId: process.env.STRIPE_STARTUP_ANNUAL_PRICE_ID,
  proMonthlyPriceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
  proAnnualPriceId: process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
  
  // Organization Price IDs
  organizationBasicMonthlyPriceId: process.env.STRIPE_ORGANIZATION_BASIC_MONTHLY_PRICE_ID,
  organizationBasicAnnualPriceId: process.env.STRIPE_ORGANIZATION_BASIC_ANNUAL_PRICE_ID,
  organizationProMonthlyPriceId: process.env.STRIPE_ORGANIZATION_PRO_MONTHLY_PRICE_ID,
  organizationProAnnualPriceId: process.env.STRIPE_ORGANIZATION_PRO_ANNUAL_PRICE_ID,
}));

// Subscription status constants
export const SUBSCRIPTION_STATUSES = {
  ACTIVE: 'active',
  CANCELED: 'canceled',
  PAST_DUE: 'past_due',
  UNPAID: 'unpaid',
  TRIALING: 'trialing',
  INCOMPLETE: 'incomplete',
  INCOMPLETE_EXPIRED: 'incomplete_expired',
} as const;

// Plan limits and features
export const PLAN_LIMITS = {
  starter: {
    maxAdAccounts: 3,
    maxTeamMembers: 1,
    features: ['basic_analytics', 'creative_gallery', 'email_support'],
  },
  professional: {
    maxAdAccounts: 10,
    maxTeamMembers: 5,
    features: ['advanced_analytics', 'custom_reporting', 'priority_support', 'team_collaboration'],
  },
  enterprise: {
    maxAdAccounts: -1, // unlimited
    maxTeamMembers: -1, // unlimited
    features: ['enterprise_analytics', 'api_access', 'custom_integrations', '24_7_support'],
  },
} as const;
