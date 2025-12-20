import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('paid-accounts')
export class PaidAccountsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getPaidAccounts(
    @CurrentUser() user: any,
    @Query('platform') platform?: string,
  ) {
    // If platform is provided, filter by platform; otherwise return all
    const seats = await this.subscriptionsService.getOrganizationSeats(user.id, platform);
    
    return {
      success: true,
      accounts: seats.map(seat => ({
        id: seat.adAccountId,
        name: seat.adAccountName,
        isPaid: true,
        isPrimary: false,
        platform: seat.platform,
        addedAt: seat.addedAt,
      })),
      count: seats.length,
    };
  }
}

