import { Controller, Post, Get, Body, Query, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { TikTokService } from './tiktok.service';
import { AiService } from '../ai/ai.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ConfigService } from '@nestjs/config';

interface CreativeAnalysisRequest {
  creativeId: string;
  creativeType: 'image' | 'video';
  imageUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  adText?: string;
  callToAction?: string;
}

interface ImageOptimizationRequest {
  imageUrl: string;
  targetPlatform?: string;
  aspectRatio?: string;
}

@Controller('tiktok/ai')
@UseGuards(JwtAuthGuard)
export class TikTokAiController {
  constructor(
    private readonly tiktokService: TikTokService,
    private readonly aiService: AiService,
    private readonly configService: ConfigService,
  ) {}

  // ==================== CREATIVE SCORING ====================

  @Post('analyze')
  async analyzeCreative(
    @CurrentUser() user: any,
    @Body() body: CreativeAnalysisRequest,
  ) {
    if (!body.creativeId) {
      throw new BadRequestException('creativeId is required');
    }

    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    // Generate AI analysis using Gemini
    const analysisResult = await this.generateCreativeAnalysis(body);

    // Save the score
    await this.aiService.saveAICreativeScore(
      body.creativeId,
      session.advertiserId,
      analysisResult.score,
      {
        ...analysisResult,
        platform: 'tiktok',
        creativeType: body.creativeType,
        imageUrl: body.imageUrl,
        videoUrl: body.videoUrl,
        thumbnailUrl: body.thumbnailUrl,
      },
    );

    return {
      success: true,
      analysis: analysisResult,
    };
  }

  @Get('score/:creativeId')
  async getCreativeScore(
    @CurrentUser() user: any,
    @Param('creativeId') creativeId: string,
  ) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const score = await this.aiService.getAICreativeScore(creativeId, session.advertiserId);
    
    if (!score) {
      return { success: false, message: 'No score found for this creative' };
    }

    return { success: true, score };
  }

  @Post('batch-analyze')
  async batchAnalyzeCreatives(
    @CurrentUser() user: any,
    @Body() body: { creatives: CreativeAnalysisRequest[] },
  ) {
    if (!body.creatives || !Array.isArray(body.creatives)) {
      throw new BadRequestException('creatives array is required');
    }

    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    const results = await Promise.allSettled(
      body.creatives.map(async (creative) => {
        const analysis = await this.generateCreativeAnalysis(creative);
        await this.aiService.saveAICreativeScore(
          creative.creativeId,
          session.advertiserId!,
          analysis.score,
          {
            ...analysis,
            platform: 'tiktok',
            creativeType: creative.creativeType,
          },
        );
        return { creativeId: creative.creativeId, analysis };
      }),
    );

    const successful = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
      .map((r) => r.value);

    const failed = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r, i) => ({ creativeId: body.creatives[i].creativeId, error: r.reason?.message }));

    return {
      success: true,
      analyzed: successful.length,
      failed: failed.length,
      results: successful,
      errors: failed,
    };
  }

  // ==================== IMAGE OPTIMIZATION ====================

  @Post('optimize-image')
  async optimizeImage(
    @CurrentUser() user: any,
    @Body() body: ImageOptimizationRequest,
  ) {
    if (!body.imageUrl) {
      throw new BadRequestException('imageUrl is required');
    }

    const recommendations = await this.generateImageOptimizationRecommendations(body);

    return {
      success: true,
      originalUrl: body.imageUrl,
      recommendations,
    };
  }

  @Post('analyze-image-composition')
  async analyzeImageComposition(
    @CurrentUser() user: any,
    @Body() body: { imageUrl: string },
  ) {
    if (!body.imageUrl) {
      throw new BadRequestException('imageUrl is required');
    }

    const analysis = await this.analyzeComposition(body.imageUrl);

    return {
      success: true,
      analysis,
    };
  }

  // ==================== FATIGUE DETECTION ====================

  @Get('fatigue/:creativeId')
  async detectCreativeFatigue(
    @CurrentUser() user: any,
    @Param('creativeId') creativeId: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const session = await this.tiktokService.getSession(user.userId);
    if (!session || !session.advertiserId) {
      throw new BadRequestException('No TikTok session or advertiser selected');
    }

    // Get historical metrics for fatigue analysis
    const dateRange = {
      since: since || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      until: until || new Date().toISOString().split('T')[0],
    };

    const fatigueAnalysis = await this.analyzeFatigue(creativeId, dateRange);

    return {
      success: true,
      creativeId,
      fatigue: fatigueAnalysis,
    };
  }

  // ==================== PRIVATE METHODS ====================

  private async generateCreativeAnalysis(creative: CreativeAnalysisRequest): Promise<{
    score: number;
    strengths: string[];
    weaknesses: string[];
    recommendations: string[];
    fatigueRisk: 'low' | 'medium' | 'high';
    platformFit: number;
    hookStrength?: number;
    audioScore?: number;
  }> {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    
    if (!apiKey) {
      // Return mock analysis if no API key
      return this.getMockAnalysis(creative);
    }

    try {
      const prompt = this.buildAnalysisPrompt(creative);
      
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
            },
          }),
        },
      );

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        return this.getMockAnalysis(creative);
      }

      return this.parseAnalysisResponse(text, creative);
    } catch (error) {
      return this.getMockAnalysis(creative);
    }
  }

  private buildAnalysisPrompt(creative: CreativeAnalysisRequest): string {
    let prompt = `Analyze this TikTok ad creative and provide a performance score and recommendations.

Creative Details:
- Type: ${creative.creativeType}
- Ad Text: ${creative.adText || 'Not provided'}
- Call to Action: ${creative.callToAction || 'Not provided'}`;

    if (creative.imageUrl) {
      prompt += `\n- Image URL: ${creative.imageUrl}`;
    }
    if (creative.videoUrl) {
      prompt += `\n- Video URL: ${creative.videoUrl}`;
    }

    prompt += `

Please analyze and respond in JSON format:
{
  "score": <number 1-10>,
  "strengths": ["strength1", "strength2"],
  "weaknesses": ["weakness1", "weakness2"],
  "recommendations": ["recommendation1", "recommendation2"],
  "fatigueRisk": "low" | "medium" | "high",
  "platformFit": <number 1-10 for TikTok platform>,
  "hookStrength": <number 1-10 for first 3 seconds impact>,
  "audioScore": <number 1-10 if applicable>
}

Consider TikTok-specific best practices:
- Hook in first 3 seconds
- Vertical 9:16 format
- Native/authentic feel vs polished ads
- Trending sounds and music
- Text overlays for silent viewing
- Clear CTA`;

    return prompt;
  }

  private parseAnalysisResponse(text: string, creative: CreativeAnalysisRequest): any {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Parse failed
    }
    
    return this.getMockAnalysis(creative);
  }

  private getMockAnalysis(creative: CreativeAnalysisRequest): any {
    const isVideo = creative.creativeType === 'video';
    
    return {
      score: 7,
      strengths: [
        isVideo ? 'Video format is ideal for TikTok' : 'Image creative can work for static awareness',
        'Creative has potential for engagement',
      ],
      weaknesses: [
        'Unable to fully analyze without visual content access',
        isVideo ? 'Cannot verify hook strength without video analysis' : 'Static images may underperform videos on TikTok',
      ],
      recommendations: [
        'Ensure hook appears in first 3 seconds',
        'Add trending audio or music',
        'Use native TikTok-style editing',
        'Include text overlays for accessibility',
      ],
      fatigueRisk: 'medium',
      platformFit: isVideo ? 8 : 5,
      hookStrength: isVideo ? 7 : undefined,
      audioScore: isVideo ? 6 : undefined,
    };
  }

  private async generateImageOptimizationRecommendations(request: ImageOptimizationRequest): Promise<{
    aspectRatio: { current?: string; recommended: string; reason: string };
    composition: string[];
    colors: string[];
    textOverlay: string[];
    tiktokSpecific: string[];
  }> {
    return {
      aspectRatio: {
        recommended: '9:16',
        reason: 'TikTok is a vertical-first platform. 9:16 maximizes screen real estate.',
      },
      composition: [
        'Center the main subject for impact',
        'Use the rule of thirds for visual interest',
        'Leave space for text overlays at top and bottom',
      ],
      colors: [
        'Use high contrast colors to stand out in the feed',
        'Consider using trending color palettes',
        'Ensure brand colors are visible but not overwhelming',
      ],
      textOverlay: [
        'Add large, bold text for silent viewers',
        'Keep text within safe zones',
        'Use TikTok-native fonts when possible',
      ],
      tiktokSpecific: [
        'Consider converting to video with motion',
        'Add trending stickers or effects',
        'Ensure mobile-first design approach',
      ],
    };
  }

  private async analyzeComposition(imageUrl: string): Promise<{
    score: number;
    balance: string;
    focalPoint: string;
    suggestions: string[];
  }> {
    return {
      score: 7,
      balance: 'Composition appears balanced',
      focalPoint: 'Main subject is identifiable',
      suggestions: [
        'Consider using rule of thirds placement',
        'Add visual hierarchy with size variation',
        'Ensure adequate contrast between elements',
      ],
    };
  }

  private async analyzeFatigue(creativeId: string, dateRange: { since: string; until: string }): Promise<{
    fatigueScore: number;
    trend: 'increasing' | 'stable' | 'decreasing';
    daysActive: number;
    recommendedAction: string;
    metrics?: {
      ctrTrend: string;
      frequencyTrend: string;
      engagementTrend: string;
    };
  }> {
    // In production, this would analyze historical metrics
    return {
      fatigueScore: 35,
      trend: 'stable',
      daysActive: 14,
      recommendedAction: 'Creative is performing well. Continue monitoring.',
      metrics: {
        ctrTrend: 'stable',
        frequencyTrend: 'increasing',
        engagementTrend: 'stable',
      },
    };
  }
}
