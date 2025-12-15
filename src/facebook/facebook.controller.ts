import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { FacebookService } from './facebook.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('facebook')
export class FacebookController {
  constructor(private readonly facebookService: FacebookService) {}

  @Get('health')
  async healthCheck() {
    return { 
      status: 'ok', 
      service: 'facebook',
      timestamp: new Date().toISOString(),
    };
  }

  // Session management
  @Get('session')
  @UseGuards(JwtAuthGuard)
  async getSession(@CurrentUser() user: any) {
    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, message: 'No Facebook session found' };
    }
    return { 
      success: true, 
      session: {
        id: session.id,
        userId: session.userId,
        adAccountId: session.adAccountId,
        tokenExpiresAt: session.tokenExpiresAt,
        hasToken: !!session.accessToken,
      }
    };
  }

  @Post('session')
  @UseGuards(JwtAuthGuard)
  async saveSession(
    @CurrentUser() user: any,
    @Body() body: { accessToken: string; adAccountId?: string; tokenExpiresAt?: string },
  ) {
    const expiresAt = body.tokenExpiresAt ? new Date(body.tokenExpiresAt) : undefined;
    const session = await this.facebookService.saveFacebookSession(
      user.userId,
      body.accessToken,
      body.adAccountId,
      expiresAt,
    );
    return { 
      success: true, 
      sessionId: session.id,
      message: 'Facebook session saved successfully',
    };
  }

  // Auth - exchange for long-lived token
  @Post('auth')
  @UseGuards(JwtAuthGuard)
  async authenticateFacebook(
    @CurrentUser() user: any,
    @Body() body: { accessToken: string; adAccountId?: string },
  ) {
    if (!body.accessToken) {
      throw new BadRequestException('Access token is required');
    }

    try {
      // Exchange for long-lived token
      const { accessToken, expiresIn } = await this.facebookService.exchangeForLongLivedToken(
        body.accessToken,
      );

      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // Get ad accounts
      const adAccounts = await this.facebookService.getAdAccounts(accessToken);

      // Save session
      const session = await this.facebookService.saveFacebookSession(
        user.userId,
        accessToken,
        body.adAccountId,
        expiresAt,
      );

      return {
        success: true,
        adAccounts,
        session: {
          id: session.id,
          expiresAt: expiresAt.toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed',
      };
    }
  }

  // Ad Accounts
  @Get('ad-accounts')
  @UseGuards(JwtAuthGuard)
  async getAdAccounts(@CurrentUser() user: any) {
    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    const adAccounts = await this.facebookService.getAdAccounts(session.accessToken);
    return { success: true, adAccounts };
  }

  // Ads
  @Get('ads')
  @UseGuards(JwtAuthGuard)
  async getAds(
    @CurrentUser() user: any,
    @Query('adAccountId') adAccountId: string,
    @Query('dateRange') dateRange: string = 'last_30d',
  ) {
    if (!adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    const result = await this.facebookService.getAds(adAccountId, session.accessToken, dateRange);
    return { success: true, ...result };
  }

  // Insights
  @Get('insights')
  @UseGuards(JwtAuthGuard)
  async getInsights(
    @CurrentUser() user: any,
    @Query('adAccountId') adAccountId: string,
    @Query('dateRange') dateRange: string = 'last_30d',
  ) {
    if (!adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    const insights = await this.facebookService.getInsights(adAccountId, session.accessToken, dateRange);
    return { success: true, insights };
  }

  // Creatives
  @Get('creatives')
  @UseGuards(JwtAuthGuard)
  async getCreatives(
    @CurrentUser() user: any,
    @Query('adAccountId') adAccountId: string,
  ) {
    if (!adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    const creatives = await this.facebookService.getCreatives(adAccountId, session.accessToken);
    return { success: true, creatives };
  }

  // Demographics
  @Get('demographics')
  @UseGuards(JwtAuthGuard)
  async getDemographics(
    @CurrentUser() user: any,
    @Query('adAccountId') adAccountId: string,
    @Query('dateRange') dateRange: string = 'last_30d',
  ) {
    if (!adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    const demographics = await this.facebookService.getDemographics(
      adAccountId,
      session.accessToken,
      dateRange,
    );
    return { success: true, demographics };
  }

  // Campaigns (cached)
  @Get('campaigns')
  @UseGuards(JwtAuthGuard)
  async getCampaigns(
    @CurrentUser() user: any,
    @Query('dateRange') dateRange: string = 'last_30d',
  ) {
    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }
    const campaigns = await this.facebookService.getCampaignData(session.id, dateRange);
    return { success: true, campaigns };
  }

  // Cache management
  @Post('cache/clear')
  @UseGuards(JwtAuthGuard)
  async clearCache(
    @Body() body: { adAccountId?: string; dateRange?: string },
  ) {
    await this.facebookService.clearCreativesCache(body.adAccountId, body.dateRange);
    return { success: true, message: 'Cache cleared' };
  }

  @Get('creatives-cache')
  @UseGuards(JwtAuthGuard)
  async getCreativesCache(
    @Query('adAccountId') adAccountId: string,
    @Query('dateRange') dateRange: string,
    @Query('maxAgeHours') maxAgeHours: string = '24',
  ) {
    if (!adAccountId || !dateRange) {
      throw new BadRequestException('adAccountId and dateRange are required');
    }

    const cached = await this.facebookService.getCreativesCache(
      adAccountId,
      dateRange,
      parseInt(maxAgeHours),
    );

    if (cached) {
      return { success: true, cached: true, data: cached };
    }
    return { success: true, cached: false, data: null };
  }

  // Adsets
  @Post('adsets')
  @UseGuards(JwtAuthGuard)
  async getAdsets(
    @CurrentUser() user: any,
    @Body() body: { accessToken?: string; adAccountId: string; dateRange?: string },
  ) {
    if (!body.adAccountId) {
      throw new BadRequestException('adAccountId is required');
    }

    let accessToken = body.accessToken;
    if (!accessToken) {
      const session = await this.facebookService.getFacebookSession(user.userId);
      if (!session) {
        return { success: false, error: 'No Facebook session found' };
      }
      accessToken = session.accessToken;
    }

    const result = await this.facebookService.getAdsets(
      body.adAccountId.replace('act_', ''),
      accessToken,
      body.dateRange || 'last_30d',
    );
    return { success: true, ...result };
  }

  // Ad Preview
  @Post('ad-preview')
  @UseGuards(JwtAuthGuard)
  async getAdPreview(
    @CurrentUser() user: any,
    @Body() body: { accessToken?: string; adId: string; format?: string },
  ) {
    if (!body.adId) {
      throw new BadRequestException('adId is required');
    }

    let accessToken = body.accessToken;
    if (!accessToken) {
      const session = await this.facebookService.getFacebookSession(user.userId);
      if (!session) {
        return { success: false, error: 'No Facebook session found' };
      }
      accessToken = session.accessToken;
    }

    const result = await this.facebookService.getAdPreview(
      body.adId,
      accessToken,
      body.format || 'DESKTOP_FEED_STANDARD',
    );
    return result;
  }

  @Get('ad-preview')
  @UseGuards(JwtAuthGuard)
  async getAdPreviewGet(
    @CurrentUser() user: any,
    @Query('adId') adId: string,
    @Query('format') format: string = 'DESKTOP_FEED_STANDARD',
  ) {
    if (!adId) {
      throw new BadRequestException('adId is required');
    }

    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    return this.facebookService.getAdPreview(adId, session.accessToken, format);
  }

  // Creative Preview
  @Get('creative-preview')
  @UseGuards(JwtAuthGuard)
  async getCreativePreview(
    @CurrentUser() user: any,
    @Query('creativeId') creativeId: string,
  ) {
    if (!creativeId) {
      throw new BadRequestException('creativeId is required');
    }

    const session = await this.facebookService.getFacebookSession(user.userId);
    if (!session) {
      return { success: false, error: 'No Facebook session found' };
    }

    const result = await this.facebookService.getCreativePreview(creativeId, session.accessToken);
    return { success: true, creative: result };
  }
}


