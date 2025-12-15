import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ShareableLinksService } from './shareable-links.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('shareable-links')
export class ShareableLinksController {
  constructor(private readonly shareableLinksService: ShareableLinksService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(
    @CurrentUser() user: any,
    @Body() body: { adAccountId?: string; expiresInDays?: number; maxUses?: number },
  ) {
    const link = await this.shareableLinksService.createShareableLink(
      user.userId,
      body.adAccountId,
      body.expiresInDays,
      body.maxUses,
    );
    return { success: true, link };
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async findAll(@CurrentUser() user: any) {
    const links = await this.shareableLinksService.getShareableLinksByUserId(user.userId);
    return { success: true, links };
  }

  @Post('validate')
  async validate(@Body() body: { token: string }) {
    const result = await this.shareableLinksService.validateShareableLink(body.token);
    if (result.valid && result.link) {
      await this.shareableLinksService.incrementShareableLinkUsage(body.token);
    }
    return result;
  }

  @Get(':token')
  async findByToken(@Param('token') token: string) {
    const link = await this.shareableLinksService.getShareableLinkByToken(token);
    if (!link) {
      return { valid: false, error: 'Link not found' };
    }
    return { valid: true, link };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/revoke')
  async revoke(@Param('id') id: string, @CurrentUser() user: any) {
    const link = await this.shareableLinksService.revokeShareableLink(+id, user.userId);
    if (!link) {
      return { success: false, error: 'Link not found or not owned by user' };
    }
    return { success: true, link };
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() user: any) {
    await this.shareableLinksService.deleteShareableLink(+id, user.userId);
    return { success: true };
  }
}
