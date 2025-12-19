import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response, Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GoogleAdsService } from './google-ads.service';
import { ConfigService } from '@nestjs/config';

interface AuthenticatedRequest extends Request {
  user?: { id: number; email: string };
}

@Controller('google-ads')
export class GoogleAdsController {
  constructor(
    private readonly googleAdsService: GoogleAdsService,
    private readonly configService: ConfigService,
  ) {}

  // ==================== SUBSCRIPTION ====================

  /**
   * Get subscription status
   */
  @Get('subscription/status')
  @UseGuards(JwtAuthGuard)
  async getSubscriptionStatus(@Req() req: AuthenticatedRequest): Promise<{
    success: boolean;
    hasSubscription: boolean;
    subscription?: any;
    seats?: any[];
    canAddMoreSeats?: boolean;
  }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    const status = await this.googleAdsService.getSubscriptionStatus(req.user.id);
    return { success: true, ...status };
  }

  // ==================== AUTH ====================

  /**
   * Get OAuth authorization URL
   */
  @Get('auth/url')
  @UseGuards(JwtAuthGuard)
  getAuthUrl(@Req() req: AuthenticatedRequest): { authUrl: string } {
    const state = req.user?.id?.toString();
    const authUrl = this.googleAdsService.getAuthUrl(state);
    return { authUrl };
  }

  /**
   * OAuth callback handler
   */
  @Get('auth/callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL') || 'http://localhost:3000';

    if (error) {
      res.redirect(`${frontendUrl}/google-ads?google_ads_error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      res.redirect(`${frontendUrl}/google-ads?google_ads_error=${encodeURIComponent('Missing code or state')}`);
      return;
    }

    const userId = parseInt(state, 10);
    if (isNaN(userId)) {
      res.redirect(`${frontendUrl}/google-ads?google_ads_error=${encodeURIComponent('Invalid state')}`);
      return;
    }

    const result = await this.googleAdsService.handleAuthCallback(userId, code);

    if (result.success) {
      res.redirect(`${frontendUrl}/google-ads?google_ads_connected=true`);
    } else {
      res.redirect(`${frontendUrl}/google-ads?google_ads_error=${encodeURIComponent(result.error || 'Auth failed')}`);
    }
  }

  /**
   * POST callback for OAuth (alternative)
   */
  @Post('auth/callback')
  @UseGuards(JwtAuthGuard)
  async handleCallbackPost(
    @Req() req: AuthenticatedRequest,
    @Body() body: { code: string; state?: string },
  ): Promise<{ success: boolean; error?: string }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    const result = await this.googleAdsService.handleAuthCallback(req.user.id, body.code);
    return { success: result.success, error: result.error };
  }

  // ==================== SESSION ====================

  /**
   * Get current session
   */
  @Get('session')
  @UseGuards(JwtAuthGuard)
  async getSession(@Req() req: AuthenticatedRequest): Promise<{
    success: boolean;
    session?: {
      id: number;
      customerId?: string;
      customerName?: string;
      tokenExpiresAt?: Date;
      hasToken: boolean;
    };
  }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    const session = await this.googleAdsService.getSession(req.user.id);

    if (!session) {
      return { success: true, session: undefined };
    }

    return {
      success: true,
      session: {
        id: session.id,
        customerId: session.customerId,
        customerName: session.customerName,
        tokenExpiresAt: session.tokenExpiresAt,
        hasToken: !!session.accessToken,
      },
    };
  }

  /**
   * Delete session (disconnect)
   */
  @Delete('session')
  @UseGuards(JwtAuthGuard)
  async deleteSession(@Req() req: AuthenticatedRequest): Promise<{ success: boolean }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    return this.googleAdsService.deleteSession(req.user.id);
  }

  /**
   * Refresh token
   */
  @Post('session/refresh')
  @UseGuards(JwtAuthGuard)
  async refreshSession(@Req() req: AuthenticatedRequest): Promise<{
    success: boolean;
    expiresAt?: Date;
    error?: string;
  }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    return this.googleAdsService.refreshToken(req.user.id);
  }

  // ==================== CUSTOMERS ====================

  /**
   * Get accessible customer accounts
   */
  @Get('customers')
  @UseGuards(JwtAuthGuard)
  async getCustomers(@Req() req: AuthenticatedRequest): Promise<{
    success: boolean;
    customers: any[];
  }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation - user needs active subscription
    await this.googleAdsService.validateSubscription(req.user.id);

    const customers = await this.googleAdsService.getAccessibleCustomers(req.user.id);
    return { success: true, customers };
  }

  /**
   * Select a customer account
   */
  @Post('customers/select')
  @UseGuards(JwtAuthGuard)
  async selectCustomer(
    @Req() req: AuthenticatedRequest,
    @Body() body: { customerId: string; customerName?: string },
  ): Promise<{ success: boolean }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation - user needs active subscription
    await this.googleAdsService.validateSubscription(req.user.id);

    return this.googleAdsService.selectCustomer(req.user.id, body.customerId, body.customerName);
  }

  // ==================== CAMPAIGNS ====================

  /**
   * Get campaigns
   */
  @Get('campaigns')
  @UseGuards(JwtAuthGuard)
  async getCampaigns(
    @Req() req: AuthenticatedRequest,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ): Promise<{ success: boolean; data: any[] }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation
    await this.googleAdsService.validateSubscription(req.user.id);

    const campaigns = await this.googleAdsService.getCampaigns(req.user.id, since, until);
    return { success: true, data: campaigns };
  }

  /**
   * Get single campaign
   */
  @Get('campaigns/:id')
  @UseGuards(JwtAuthGuard)
  async getCampaign(
    @Req() req: AuthenticatedRequest,
    @Param('id') campaignId: string,
  ): Promise<{ success: boolean; data?: any }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation
    await this.googleAdsService.validateSubscription(req.user.id);

    const campaign = await this.googleAdsService.getCampaign(req.user.id, campaignId);
    return { success: true, data: campaign };
  }

  // ==================== AD GROUPS ====================

  /**
   * Get ad groups
   */
  @Get('adgroups')
  @UseGuards(JwtAuthGuard)
  async getAdGroups(
    @Req() req: AuthenticatedRequest,
    @Query('campaignId') campaignId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ): Promise<{ success: boolean; data: any[] }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation
    await this.googleAdsService.validateSubscription(req.user.id);

    const adGroups = await this.googleAdsService.getAdGroups(req.user.id, campaignId, since, until);
    return { success: true, data: adGroups };
  }

  // ==================== ADS ====================

  /**
   * Get ads
   */
  @Get('ads')
  @UseGuards(JwtAuthGuard)
  async getAds(
    @Req() req: AuthenticatedRequest,
    @Query('adGroupId') adGroupId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ): Promise<{ success: boolean; data: any[] }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation
    await this.googleAdsService.validateSubscription(req.user.id);

    const ads = await this.googleAdsService.getAds(req.user.id, adGroupId, since, until);
    return { success: true, data: ads };
  }

  // ==================== METRICS ====================

  /**
   * Get account-level metrics
   */
  @Get('metrics/account')
  @UseGuards(JwtAuthGuard)
  async getAccountMetrics(
    @Req() req: AuthenticatedRequest,
    @Query('since') since: string,
    @Query('until') until: string,
  ): Promise<{ success: boolean; data: any }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation
    await this.googleAdsService.validateSubscription(req.user.id);

    if (!since || !until) {
      // Default to last 30 days
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      since = startDate.toISOString().split('T')[0];
      until = endDate.toISOString().split('T')[0];
    }

    const metrics = await this.googleAdsService.getAccountMetrics(req.user.id, since, until);
    return { success: true, data: metrics };
  }

  /**
   * Get metrics by date (for charts)
   */
  @Get('metrics/by-date')
  @UseGuards(JwtAuthGuard)
  async getMetricsByDate(
    @Req() req: AuthenticatedRequest,
    @Query('since') since: string,
    @Query('until') until: string,
  ): Promise<{ success: boolean; data: any[] }> {
    if (!req.user?.id) {
      throw new UnauthorizedException('Not authenticated');
    }

    // Subscription validation
    await this.googleAdsService.validateSubscription(req.user.id);

    if (!since || !until) {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      since = startDate.toISOString().split('T')[0];
      until = endDate.toISOString().split('T')[0];
    }

    const data = await this.googleAdsService.getMetricsByDate(req.user.id, since, until);
    return { success: true, data };
  }
}
