import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards, BadRequestException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TikTokService } from './tiktok.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

@Controller('tiktok')
export class TikTokController {
  constructor(
    private readonly tiktokService: TikTokService,
    private readonly configService: ConfigService,
  ) {}

  @Get('health')
  async healthCheck() {
    return {
      status: 'ok',
      service: 'tiktok',
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== OAUTH ====================

  @Get('auth/url')
  @UseGuards(JwtAuthGuard)
  async getAuthUrl(@CurrentUser() user: any) {
    const appId = this.configService.get<string>('tiktok.appId');
    const redirectUri = this.configService.get<string>('tiktok.redirectUri');
    const state = Buffer.from(JSON.stringify({ userId: user.userId })).toString('base64');

    const authUrl = `https://business-api.tiktok.com/portal/auth?app_id=${appId}&state=${state}&redirect_uri=${encodeURIComponent(redirectUri!)}&rid=unique_request_id`;

    return { success: true, authUrl };
  }

  @Get('auth/callback')
  async handleAuthCallback(
    @Query('auth_code') authCode: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      if (!authCode || !state) {
        throw new BadRequestException('Missing auth_code or state');
      }

      const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
      const userId = stateData.userId;

      const appId = this.configService.get<string>('tiktok.appId');
      const appSecret = this.configService.get<string>('tiktok.appSecret');

      // Exchange auth code for access token
      const tokenResponse = await fetch('https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: appId,
          secret: appSecret,
          auth_code: authCode,
        }),
      });

      const tokenData = await tokenResponse.json();

      if (tokenData.code !== 0) {
        throw new Error(`Token exchange failed: ${tokenData.message}`);
      }

      const { access_token, refresh_token, expires_in, refresh_token_expires_in, advertiser_ids } = tokenData.data;

      const tokenExpiresAt = new Date(Date.now() + expires_in * 1000);
      const refreshTokenExpiresAt = new Date(Date.now() + refresh_token_expires_in * 1000);

      // Get first advertiser info
      let advertiserName: string | undefined;
      if (advertiser_ids?.length > 0) {
        try {
          const advertiserInfo = await this.tiktokService.getAdvertiserInfo(access_token, advertiser_ids[0]);
          advertiserName = advertiserInfo?.name;
        } catch (e) {
          // Continue without advertiser name
        }
      }

      await this.tiktokService.saveSession(
        userId,
        access_token,
        refresh_token,
        advertiser_ids?.[0],
        advertiserName,
        tokenExpiresAt,
        refreshTokenExpiresAt,
      );

      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/dashboard?tiktok_connected=true`);
    } catch (error: any) {
      const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/dashboard?tiktok_error=${encodeURIComponent(error.message)}`);
    }
  }

  // ==================== SESSION ====================

  @Get('session')
  @UseGuards(JwtAuthGuard)
  async getSession(@CurrentUser() user: any) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session) {
      return { success: false, message: 'No TikTok session found' };
    }
    return {
      success: true,
      session: {
        id: session.id,
        userId: session.userId,
        advertiserId: session.advertiserId,
        advertiserName: session.advertiserName,
        tokenExpiresAt: session.tokenExpiresAt,
        hasToken: !!session.accessToken,
      },
    };
  }

  @Delete('session')
  @UseGuards(JwtAuthGuard)
  async deleteSession(@CurrentUser() user: any) {
    await this.tiktokService.deleteSession(user.userId);
    return { success: true, message: 'TikTok session deleted' };
  }

  @Post('session/refresh')
  @UseGuards(JwtAuthGuard)
  async refreshToken(@CurrentUser() user: any) {
    const session = await this.tiktokService.refreshAccessToken(user.userId);
    return { success: true, expiresAt: session.tokenExpiresAt };
  }

  // ==================== ADVERTISERS ====================

  @Get('advertisers')
  @UseGuards(JwtAuthGuard)
  async getAdvertisers(@CurrentUser() user: any) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session) {
      throw new BadRequestException('No TikTok session found');
    }

    const appId = this.configService.get<string>('tiktok.appId')!;
    const advertisers = await this.tiktokService.getAuthorizedAdvertisers(session.accessToken, appId);
    return { success: true, advertisers };
  }

  @Post('advertisers/select')
  @UseGuards(JwtAuthGuard)
  async selectAdvertiser(
    @CurrentUser() user: any,
    @Body() body: { advertiserId: string; advertiserName?: string },
  ) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session) {
      throw new BadRequestException('No TikTok session found');
    }

    await this.tiktokService.saveSession(
      user.userId,
      session.accessToken,
      session.refreshToken,
      body.advertiserId,
      body.advertiserName,
      session.tokenExpiresAt,
      session.refreshTokenExpiresAt,
    );

    return { success: true, advertiserId: body.advertiserId };
  }

  // ==================== CAMPAIGNS ====================

  @Get('campaigns')
  @UseGuards(JwtAuthGuard)
  async getCampaigns(
    @CurrentUser() user: any,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const dateRange = since && until ? { since, until } : undefined;
    const result = await this.tiktokService.getCampaigns(session.accessToken, session.advertiserId, dateRange);
    return result;
  }

  @Get('campaigns/:id')
  @UseGuards(JwtAuthGuard)
  async getCampaign(@CurrentUser() user: any, @Param('id') campaignId: string) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session) {
      throw new BadRequestException('No TikTok session found');
    }

    const result = await this.tiktokService.getCampaign(session.accessToken, campaignId);
    return result;
  }

  // ==================== AD GROUPS ====================

  @Get('adgroups')
  @UseGuards(JwtAuthGuard)
  async getAdGroups(
    @CurrentUser() user: any,
    @Query('campaignId') campaignId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const dateRange = since && until ? { since, until } : undefined;
    const result = await this.tiktokService.getAdGroups(session.accessToken, session.advertiserId, campaignId, dateRange);
    return result;
  }

  @Get('adgroups/:id')
  @UseGuards(JwtAuthGuard)
  async getAdGroup(@CurrentUser() user: any, @Param('id') adGroupId: string) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session) {
      throw new BadRequestException('No TikTok session found');
    }

    const result = await this.tiktokService.getAdGroup(session.accessToken, adGroupId);
    return result;
  }

  // ==================== ADS ====================

  @Get('ads')
  @UseGuards(JwtAuthGuard)
  async getAds(
    @CurrentUser() user: any,
    @Query('adgroupId') adGroupId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const dateRange = since && until ? { since, until } : undefined;
    const result = await this.tiktokService.getAds(session.accessToken, session.advertiserId, adGroupId, dateRange);
    return result;
  }

  @Get('ads/:id')
  @UseGuards(JwtAuthGuard)
  async getAd(@CurrentUser() user: any, @Param('id') adId: string) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session) {
      throw new BadRequestException('No TikTok session found');
    }

    const result = await this.tiktokService.getAd(session.accessToken, adId);
    return result;
  }

  // ==================== METRICS ====================

  @Get('metrics/account')
  @UseGuards(JwtAuthGuard)
  async getAccountMetrics(
    @CurrentUser() user: any,
    @Query('since') since: string,
    @Query('until') until: string,
  ) {
    if (!since || !until) {
      throw new BadRequestException('since and until date parameters are required');
    }

    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const result = await this.tiktokService.getAccountMetrics(session.accessToken, session.advertiserId, { since, until });
    return result;
  }

  // ==================== CREATIVES ====================

  @Get('creatives/:id')
  @UseGuards(JwtAuthGuard)
  async getCreative(@CurrentUser() user: any, @Param('id') creativeId: string) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const creative = await this.tiktokService.getCreativeInfo(session.accessToken, session.advertiserId, creativeId);
    return { success: true, creative };
  }

  @Get('videos/:id')
  @UseGuards(JwtAuthGuard)
  async getVideoInfo(@CurrentUser() user: any, @Param('id') videoId: string) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const video = await this.tiktokService.getVideoInfo(session.accessToken, session.advertiserId, videoId);
    return { success: true, video };
  }

  @Get('images/:id')
  @UseGuards(JwtAuthGuard)
  async getImageInfo(@CurrentUser() user: any, @Param('id') imageId: string) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const image = await this.tiktokService.getImageInfo(session.accessToken, session.advertiserId, imageId);
    return { success: true, image };
  }
}
