import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard) // Protect all endpoints
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('profile')
  async getProfile(@CurrentUser() user: any) {
    const fullUser = await this.usersService.findOne(user.userId);
    if (!fullUser) {
      throw new NotFoundException('User not found');
    }
    const { password, ...result } = fullUser;
    return result;
  }

  @Patch('profile')
  async updateProfile(@CurrentUser() user: any, @Body() updateData: Partial<User>) {
    // Only allow updating own profile, exclude sensitive fields
    const { password, role, id, ...safeUpdates } = updateData as any;
    return this.usersService.update(user.userId, safeUpdates);
  }

  @Post('change-password')
  async changePassword(
    @CurrentUser() user: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    await this.usersService.changePassword(
      user.userId,
      changePasswordDto.currentPassword,
      changePasswordDto.newPassword,
    );
    return { success: true, message: 'Password updated successfully' };
  }

  @Get('trial-status')
  async getTrialStatus(@CurrentUser() user: any) {
    const trialStatus = await this.usersService.getTrialStatus(user.userId);
    return { success: true, trial: trialStatus };
  }

  @Get('subscription')
  async getSubscription(@CurrentUser() user: any) {
    const fullUser = await this.usersService.findOne(user.userId);
    if (!fullUser) {
      throw new NotFoundException('User not found');
    }
    return {
      success: true,
      subscription: {
        currentPlanId: fullUser.currentPlanId,
        currentPlanName: fullUser.currentPlanName,
        currentBillingCycle: fullUser.currentBillingCycle,
        subscriptionStatus: fullUser.subscriptionStatus,
      },
    };
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @CurrentUser() user: any) {
    // Users can only view their own data (or admins could view all)
    if (user.userId !== +id) {
      throw new ForbiddenException('You can only view your own profile');
    }
    const foundUser = await this.usersService.findOne(+id);
    if (!foundUser) {
      throw new NotFoundException('User not found');
    }
    const { password, ...result } = foundUser;
    return result;
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() updateData: Partial<User>, @CurrentUser() user: any) {
    // Users can only update their own data
    if (user.userId !== +id) {
      throw new ForbiddenException('You can only update your own profile');
    }
    // Prevent updating sensitive fields via this endpoint
    const { password, role, id: userId, ...safeUpdates } = updateData as any;
    return this.usersService.update(+id, safeUpdates);
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    // Users can only delete their own account
    if (user.userId !== +id) {
      throw new ForbiddenException('You can only delete your own account');
    }
    await this.usersService.remove(+id);
    return { success: true, message: 'Account deleted successfully' };
  }
}

