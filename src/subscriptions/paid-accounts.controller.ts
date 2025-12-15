import { Controller, Get, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('paid-accounts')
export class PaidAccountsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  async getPaidAccounts(@CurrentUser() user: any) {
    const seats = await this.subscriptionsService.getOrganizationSeats(user.userId);
    
    return {
      success: true,
      paidAccounts: seats.map(seat => ({
        adAccountId: seat.adAccountId,
        adAccountName: seat.adAccountName,
        status: seat.status,
        addedAt: seat.addedAt,
      })),
      count: seats.length,
    };
  }
}
