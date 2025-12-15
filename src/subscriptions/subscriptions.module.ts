import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsService } from './subscriptions.service';
import { PlatformSubscriptionsService } from './platform-subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { OrganizationSubscriptionsController } from './organization-subscriptions.controller';
import { PaidAccountsController } from './paid-accounts.controller';
import { PlatformSubscriptionsController } from './platform-subscriptions.controller';
import { Subscription } from './entities/subscription.entity';
import { StripeCustomer } from './entities/stripe-customer.entity';
import { Invoice } from './entities/invoice.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { OrganizationSeat } from './entities/organization-seat.entity';
import { OrganizationBillingHistory } from './entities/organization-billing-history.entity';
import { PlatformSubscription } from './entities/platform-subscription.entity';
import { PlatformSeat } from './entities/platform-seat.entity';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Subscription,
      StripeCustomer,
      Invoice,
      PaymentMethod,
      OrganizationSubscription,
      OrganizationSeat,
      OrganizationBillingHistory,
      PlatformSubscription,
      PlatformSeat,
    ]),
    forwardRef(() => StripeModule),
  ],
  controllers: [SubscriptionsController, OrganizationSubscriptionsController, PaidAccountsController, PlatformSubscriptionsController],
  providers: [SubscriptionsService, PlatformSubscriptionsService],
  exports: [SubscriptionsService, PlatformSubscriptionsService],
})
export class SubscriptionsModule {}


