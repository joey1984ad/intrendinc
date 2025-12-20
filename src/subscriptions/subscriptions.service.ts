import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Subscription } from './entities/subscription.entity';
import { StripeCustomer } from './entities/stripe-customer.entity';
import { Invoice } from './entities/invoice.entity';
import { PaymentMethod } from './entities/payment-method.entity';
import { OrganizationSubscription } from './entities/organization-subscription.entity';
import { OrganizationSeat } from './entities/organization-seat.entity';
import { OrganizationBillingHistory } from './entities/organization-billing-history.entity';

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private subscriptionRepository: Repository<Subscription>,
    @InjectRepository(StripeCustomer)
    private stripeCustomerRepository: Repository<StripeCustomer>,
    @InjectRepository(Invoice)
    private invoiceRepository: Repository<Invoice>,
    @InjectRepository(PaymentMethod)
    private paymentMethodRepository: Repository<PaymentMethod>,
    @InjectRepository(OrganizationSubscription)
    private organizationSubscriptionRepository: Repository<OrganizationSubscription>,
    @InjectRepository(OrganizationSeat)
    private organizationSeatRepository: Repository<OrganizationSeat>,
    @InjectRepository(OrganizationBillingHistory)
    private organizationBillingHistoryRepository: Repository<OrganizationBillingHistory>,
  ) {}

  // Stripe Customer Management
  async createStripeCustomer(userId: number, stripeCustomerId: string, email: string): Promise<StripeCustomer> {
    const customer = this.stripeCustomerRepository.create({
      userId,
      stripeCustomerId,
      email,
    });
    return this.stripeCustomerRepository.save(customer);
  }

  async getStripeCustomer(userId: number): Promise<StripeCustomer | null> {
    return this.stripeCustomerRepository.findOneBy({ userId });
  }

  async deleteStripeCustomer(userId: number): Promise<void> {
    await this.stripeCustomerRepository.delete({ userId });
  }

  // Subscription Management
  async createSubscription(subscriptionData: Partial<Subscription>): Promise<Subscription> {
    const subscription = this.subscriptionRepository.create(subscriptionData);
    return this.subscriptionRepository.save(subscription);
  }

  async updateSubscription(stripeSubscriptionId: string, updates: Partial<Subscription>): Promise<Subscription | null> {
    await this.subscriptionRepository.update({ stripeSubscriptionId }, updates);
    return this.subscriptionRepository.findOneBy({ stripeSubscriptionId });
  }

  async getSubscriptionByUserId(userId: number): Promise<Subscription | null> {
    return this.subscriptionRepository.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getSubscriptionByStripeId(stripeSubscriptionId: string): Promise<Subscription | null> {
    return this.subscriptionRepository.findOneBy({ stripeSubscriptionId });
  }

  // Invoice Management
  async createInvoice(invoiceData: Partial<Invoice>): Promise<Invoice> {
    const invoice = this.invoiceRepository.create(invoiceData);
    return this.invoiceRepository.save(invoice);
  }

  async getInvoiceByStripeId(stripeInvoiceId: string): Promise<Invoice | null> {
    return this.invoiceRepository.findOneBy({ stripeInvoiceId });
  }

  async updateInvoice(stripeInvoiceId: string, updateData: Partial<Invoice>): Promise<Invoice | null> {
    await this.invoiceRepository.update({ stripeInvoiceId }, updateData);
    return this.invoiceRepository.findOneBy({ stripeInvoiceId });
  }

  async getInvoicesByUserId(userId: number): Promise<Invoice[]> {
    return this.invoiceRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // Payment Method Management
  async createPaymentMethod(paymentMethodData: Partial<PaymentMethod>): Promise<PaymentMethod> {
    if (paymentMethodData.isDefault !== false) {
      const count = await this.paymentMethodRepository.count({ where: { userId: paymentMethodData.userId } });
      if (count === 0) {
        paymentMethodData.isDefault = true;
      }
    }
    const paymentMethod = this.paymentMethodRepository.create(paymentMethodData);
    return this.paymentMethodRepository.save(paymentMethod);
  }

  async getPaymentMethodsByUserId(userId: number): Promise<PaymentMethod[]> {
    return this.paymentMethodRepository.find({
      where: { userId },
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
  }

  async deletePaymentMethod(id: number): Promise<void> {
    await this.paymentMethodRepository.delete(id);
  }

  // Organization Subscription Management
  async createOrganizationSubscription(data: Partial<OrganizationSubscription>): Promise<OrganizationSubscription> {
    const sub = this.organizationSubscriptionRepository.create(data);
    return this.organizationSubscriptionRepository.save(sub);
  }

  async getOrganizationSubscription(userId: number): Promise<OrganizationSubscription | null> {
    return this.organizationSubscriptionRepository.findOne({
      where: [
        { userId, status: 'active' },
        { userId, status: 'trialing' },
        { userId, status: 'past_due' },
      ],
      order: { createdAt: 'DESC' },
    });
  }

  async getOrganizationSubscriptionById(id: number): Promise<OrganizationSubscription | null> {
    return this.organizationSubscriptionRepository.findOneBy({ id });
  }

  async getOrganizationSubscriptionByStripeId(stripeSubscriptionId: string): Promise<OrganizationSubscription | null> {
    return this.organizationSubscriptionRepository.findOneBy({ stripeSubscriptionId });
  }

  async updateOrganizationSubscriptionQuantity(id: number, quantity: number): Promise<OrganizationSubscription | null> {
    await this.organizationSubscriptionRepository.update(id, { quantity });
    return this.organizationSubscriptionRepository.findOneBy({ id });
  }

  async updateOrganizationSubscriptionStatus(id: number, status: string): Promise<OrganizationSubscription | null> {
    await this.organizationSubscriptionRepository.update(id, { status });
    return this.organizationSubscriptionRepository.findOneBy({ id });
  }

  async addOrganizationSeat(
    organizationSubscriptionId: number, 
    userId: number, 
    adAccountId: string, 
    adAccountName: string,
    platform: string = 'facebook',
  ): Promise<OrganizationSeat> {
    const seat = this.organizationSeatRepository.create({
      organizationSubscriptionId,
      userId,
      adAccountId,
      adAccountName,
      platform,
      status: 'active',
      addedAt: new Date(),
    });
    return this.organizationSeatRepository.save(seat);
  }

  async addOrganizationBillingHistory(data: Partial<OrganizationBillingHistory>): Promise<OrganizationBillingHistory> {
    const history = this.organizationBillingHistoryRepository.create(data);
    return this.organizationBillingHistoryRepository.save(history);
  }

  async getOrganizationSeats(userId: number, platform?: string): Promise<OrganizationSeat[]> {
    const where: any = { userId, status: 'active' };
    if (platform) {
      where.platform = platform;
    }
    return this.organizationSeatRepository.find({
      where,
      order: { addedAt: 'DESC' },
    });
  }

  async getOrganizationSeatsBySubscription(subscriptionId: number): Promise<OrganizationSeat[]> {
    return this.organizationSeatRepository.find({
      where: { organizationSubscriptionId: subscriptionId },
      order: { addedAt: 'DESC' },
    });
  }

  async deactivateOrganizationSeat(seatId: number): Promise<void> {
    await this.organizationSeatRepository.update(seatId, { status: 'removed' });
  }

  async getOrganizationBillingHistory(userId: number): Promise<OrganizationBillingHistory[]> {
    return this.organizationBillingHistoryRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }
}

