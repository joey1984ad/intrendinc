import { Controller, Get, Post, Body, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('facebook/ads-library-embed')
export class AdsLibraryEmbedController {
  // POST /facebook/ads-library-embed - Generate embed code
  @Post()
  @UseGuards(JwtAuthGuard)
  async generateEmbed(
    @Body() body: {
      adId?: string;
      creativeId?: string;
      width?: number;
      height?: number;
    },
  ) {
    const { adId, creativeId, width = 500, height = 500 } = body;

    if (!adId && !creativeId) {
      throw new BadRequestException('Either adId or creativeId is required');
    }

    const targetId = adId || creativeId;

    const embedUrls = [
      `https://www.facebook.com/ads/library/preview/?id=${targetId}`,
      `https://www.facebook.com/ads/library/preview/?creative_id=${targetId}`,
      `https://www.facebook.com/ads/library/?id=${targetId}`,
    ];

    const generateEmbedObject = (url: string) => ({
      embedUrl: url,
      iframeHtml: `<iframe src="${url}" width="${width}" height="${height}" style="border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" loading="lazy" title="Facebook Ad Preview"></iframe>`,
      dimensions: { width, height },
    });

    const embed = generateEmbedObject(embedUrls[0]);
    const alternatives = embedUrls.map(url => generateEmbedObject(url));

    return {
      success: true,
      embed,
      alternatives,
      message: 'Facebook Ads Library embed generated',
    };
  }

  // GET /facebook/ads-library-embed - Generate embed via query params
  @Get()
  @UseGuards(JwtAuthGuard)
  async generateEmbedGet(
    @Query('adId') adId?: string,
    @Query('creativeId') creativeId?: string,
    @Query('width') widthStr?: string,
    @Query('height') heightStr?: string,
  ) {
    if (!adId && !creativeId) {
      throw new BadRequestException('Either adId or creativeId is required');
    }

    const width = parseInt(widthStr || '500');
    const height = parseInt(heightStr || '500');

    return this.generateEmbed({ adId, creativeId, width, height });
  }
}
