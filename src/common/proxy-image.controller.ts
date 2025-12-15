import { Controller, Get, Post, Query, Body, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';

@Controller('proxy-image')
export class ProxyImageController {
  @Get()
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      throw new BadRequestException('URL is required');
    }

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        res.status(response.status).send('Failed to fetch image');
        return;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = await response.arrayBuffer();

      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(buffer));
    } catch (error) {
      res.status(500).send('Failed to proxy image');
    }
  }
}

@Controller('proxy-image-batch')
export class ProxyImageBatchController {
  @Post()
  async proxyImageBatch(@Body() body: { urls: string[] }) {
    if (!body.urls || !Array.isArray(body.urls)) {
      throw new BadRequestException('urls array is required');
    }

    const results = await Promise.all(
      body.urls.map(async (url) => {
        try {
          const response = await fetch(url);
          
          if (!response.ok) {
            return { url, success: false, error: 'Failed to fetch' };
          }

          const contentType = response.headers.get('content-type') || 'image/jpeg';
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');

          return {
            url,
            success: true,
            data: `data:${contentType};base64,${base64}`,
          };
        } catch (error) {
          return { url, success: false, error: 'Failed to proxy' };
        }
      }),
    );

    return { success: true, results };
  }
}
