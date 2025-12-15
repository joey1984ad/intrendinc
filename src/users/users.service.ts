import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  create(userData: Partial<User>): Promise<User> {
    const user = this.usersRepository.create(userData);
    return this.usersRepository.save(user);
  }

  findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  findOne(id: number): Promise<User | null> {
    return this.usersRepository.findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOneBy({ email });
  }

  async update(id: number, updateData: Partial<User>): Promise<User> {
    await this.usersRepository.update(id, updateData);
    return this.usersRepository.findOneBy({ id }) as Promise<User>;
  }

  async remove(id: number): Promise<void> {
    await this.usersRepository.delete(id);
  }

  async createTrial(userData: Partial<User>): Promise<User> {
    const trialStart = new Date();
    const trialEnd = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days

    const user = this.usersRepository.create({
      ...userData,
      isTrialUser: true,
      trialStart,
      trialEnd,
      currentPlanId: 'free',
      currentPlanName: 'Free Trial',
      subscriptionStatus: 'trialing',
    });
    return this.usersRepository.save(user);
  }

  async updatePlan(
    userId: number,
    planData: {
      planId: string;
      planName: string;
      billingCycle: string;
      status: string;
    },
  ): Promise<User> {
    await this.usersRepository.update(userId, {
      currentPlanId: planData.planId,
      currentPlanName: planData.planName,
      currentBillingCycle: planData.billingCycle,
      subscriptionStatus: planData.status,
    });
    return this.usersRepository.findOneBy({ id: userId }) as Promise<User>;
  }

  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    
    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Check if user has a password (OAuth users might not)
    if (!user.password) {
      throw new BadRequestException(
        'Password change not available for accounts created with social login. Please set a password first.'
      );
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // Check if new password is different
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      throw new BadRequestException('New password must be different from current password');
    }

    // Hash and update
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await this.usersRepository.update(userId, { password: hashedPassword });
  }

  async getTrialStatus(userId: number): Promise<{
    isTrialUser: boolean;
    isTrialActive: boolean;
    isTrialExpired: boolean;
    trialStart: Date | null;
    trialEnd: Date | null;
    daysRemaining: number | null;
    subscriptionStatus: string;
    currentPlanId: string;
    currentPlanName: string;
  }> {
    const user = await this.usersRepository.findOneBy({ id: userId });
    
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const now = new Date();
    const trialEnd = user.trialEnd ? new Date(user.trialEnd) : null;
    
    const isTrialActive = user.isTrialUser && trialEnd && trialEnd > now;
    const isTrialExpired = user.isTrialUser && trialEnd && trialEnd <= now;
    
    let daysRemaining: number | null = null;
    if (isTrialActive && trialEnd) {
      const diffTime = trialEnd.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    return {
      isTrialUser: user.isTrialUser,
      isTrialActive: !!isTrialActive,
      isTrialExpired: !!isTrialExpired,
      trialStart: user.trialStart,
      trialEnd: user.trialEnd,
      daysRemaining,
      subscriptionStatus: user.subscriptionStatus,
      currentPlanId: user.currentPlanId,
      currentPlanName: user.currentPlanName,
    };
  }
}

