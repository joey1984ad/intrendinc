import { Controller, Post, Body, Logger } from '@nestjs/common';
import { GeminiService } from './services/gemini.service';
import { AiService } from './ai.service';

@Controller('analyze-creatives')
export class AnalyzeCreativesController {
  private readonly logger = new Logger(AnalyzeCreativesController.name);

  constructor(
    private readonly geminiService: GeminiService,
    private readonly aiService: AiService,
  ) {}

  @Post()
  async analyzeCreative(@Body() webhookData: any) {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Test request handling
    if (webhookData.test === true) {
      return {
        status: 'success',
        message: 'Webhook test successful',
        connected: true,
        timestamp: new Date().toISOString(),
        version: '2.0-gemini',
        webhookUrl: webhookData.webhookUrl,
        executionMode: webhookData.executionMode || 'production',
      };
    }

    // Validation
    const validationErrors: string[] = [];

    if (!webhookData.creativeId) {
      validationErrors.push('Missing creative ID');
    }
    if (!webhookData.adAccountId) {
      validationErrors.push('Missing ad account ID');
    }

    const imageUrl =
      webhookData.imageUrl ||
      webhookData.thumbnailUrl ||
      webhookData.creativeUrl ||
      webhookData.url ||
      webhookData.image ||
      webhookData.thumbnail;

    if (!imageUrl) {
      validationErrors.push('Missing image URL');
    }

    if (validationErrors.length > 0) {
      return {
        error: 'Validation failed',
        message: `Multiple validation errors: ${validationErrors.join(', ')}`,
        sessionId,
        validationErrors,
        timestamp: new Date().toISOString(),
      };
    }

    try {
      const result = await this.geminiService.analyzeCreative({
        imageUrl,
        creativeId: webhookData.creativeId,
        adAccountId: webhookData.adAccountId,
        creativeType: webhookData.creativeType,
        accessToken: webhookData.accessToken,
      });

      // Save the score to database
      if (result.score) {
        await this.aiService.saveAICreativeScore(
          webhookData.creativeId,
          webhookData.adAccountId,
          result.score,
          {
            ...result.analysis,
            dimensions: result.dimensions,
            improvements: result.improvements,
            recommendations: result.recommendations,
          },
        );
      }

      return {
        ...result,
        optimizationStatus: 'completed',
        sessionId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Analysis failed: ${errorMessage}`);

      return {
        success: false,
        error: 'Analysis Failed',
        message: errorMessage,
        sessionId,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
