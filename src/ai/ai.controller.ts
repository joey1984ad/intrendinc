import { Controller, Get, Post, Put, Delete, Body, Query, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  // Creative Score endpoints
  @Post('creative-score')
  @UseGuards(JwtAuthGuard)
  async saveCreativeScore(
    @Body() body: {
      creativeId: string;
      adAccountId: string;
      score: number;
      analysisData?: any;
      imageUrl?: string;
      creativeType?: string;
    },
  ) {
    if (!body.creativeId || !body.adAccountId || body.score === undefined) {
      throw new BadRequestException('Missing required fields: creativeId, adAccountId, score');
    }

    if (typeof body.score !== 'number' || body.score < 0 || body.score > 10) {
      throw new BadRequestException('Score must be a number between 0 and 10');
    }

    const enhancedAnalysisData = {
      ...body.analysisData,
      timestamp: new Date().toISOString(),
      creativeType: body.creativeType || 'image',
      imageUrl: body.imageUrl || null,
      analysisVersion: '2.0-enhanced',
    };

    const savedId = await this.aiService.saveAICreativeScore(
      body.creativeId,
      body.adAccountId,
      body.score,
      enhancedAnalysisData,
    );

    return {
      success: true,
      id: savedId,
      message: `AI score ${body.score}/10 saved for creative ${body.creativeId}`,
    };
  }

  @Get('creative-score')
  @UseGuards(JwtAuthGuard)
  async getCreativeScore(
    @Query('creativeId') creativeId: string,
    @Query('adAccountId') adAccountId: string,
  ) {
    if (!creativeId || !adAccountId) {
      throw new BadRequestException('Missing required query parameters: creativeId, adAccountId');
    }

    const scoreData = await this.aiService.getAICreativeScore(creativeId, adAccountId);

    if (!scoreData) {
      return { score: null, message: 'No AI score found for this creative' };
    }

    return {
      success: true,
      score: scoreData.score,
      analysisData: scoreData.analysisData,
      createdAt: scoreData.createdAt,
      updatedAt: scoreData.updatedAt,
    };
  }

  // AI Generated Creatives - CREATE
  @Post('creatives')
  @UseGuards(JwtAuthGuard)
  async createCreative(@CurrentUser() user: any, @Body() creativeData: any) {
    const id = await this.aiService.saveAIGeneratedCreative(user.userId, creativeData);
    return { success: true, id };
  }

  // AI Generated Creatives - LIST
  @Get('creatives')
  @UseGuards(JwtAuthGuard)
  async getCreatives(
    @CurrentUser() user: any,
    @Query('adAccountId') adAccountId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.aiService.getAIGeneratedCreatives(user.userId, {
      adAccountId,
      status,
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
    });

    return { success: true, ...result };
  }

  // AI Generated Creatives - GET SINGLE
  @Get('creatives/:id')
  @UseGuards(JwtAuthGuard)
  async getCreative(@Param('id') id: string, @CurrentUser() user: any) {
    const creative = await this.aiService.getAIGeneratedCreative(+id, user.userId);
    return { success: true, creative };
  }

  // AI Generated Creatives - UPDATE
  @Put('creatives/:id')
  @UseGuards(JwtAuthGuard)
  async updateCreative(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() updateData: any,
  ) {
    const creative = await this.aiService.updateAIGeneratedCreative(+id, user.userId, updateData);
    return { success: true, creative };
  }

  // AI Generated Creatives - DELETE
  @Delete('creatives/:id')
  @UseGuards(JwtAuthGuard)
  async deleteCreative(@Param('id') id: string, @CurrentUser() user: any) {
    await this.aiService.deleteAIGeneratedCreative(+id, user.userId);
    return { success: true, message: 'Creative deleted successfully' };
  }

  // AI Generated Creatives - BULK SAVE
  @Post('creatives/bulk')
  @UseGuards(JwtAuthGuard)
  async bulkSaveCreatives(@CurrentUser() user: any, @Body() body: { creatives: any[] }) {
    if (!body.creatives || !Array.isArray(body.creatives)) {
      throw new BadRequestException('creatives array is required');
    }

    const ids = await this.aiService.bulkSaveAICreatives(user.userId, body.creatives);
    return { success: true, ids, count: ids.length };
  }

  // Toggle favorite
  @Post('creatives/:id/favorite')
  @UseGuards(JwtAuthGuard)
  async toggleFavorite(@Param('id') id: string, @CurrentUser() user: any) {
    const creative = await this.aiService.toggleFavorite(+id, user.userId);
    return { success: true, isFavorite: creative.isFavorite };
  }

  // Legacy endpoint alias
  @Post('generated-creative')
  @UseGuards(JwtAuthGuard)
  async saveGeneratedCreative(@CurrentUser() user: any, @Body() creativeData: any) {
    const id = await this.aiService.saveAIGeneratedCreative(user.userId, creativeData);
    return { success: true, id };
  }
}

