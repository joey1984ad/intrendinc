import { Injectable, Logger, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AnalysisResult {
  success: boolean;
  score: number;
  aiScore: number;
  imageUrl: string;
  originalImageUrl: string;
  tokenizationApplied: boolean;
  analysis: {
    main: string;
    detailed: string;
    strengths: string[];
    issues: string[];
  };
  improvements: string[];
  recommendations: string[];
  dimensions: Record<string, number>;
  metadata: Record<string, any>;
}

interface VariationResult {
  id: string;
  key: string;
  title: string;
  description: string;
  imageUrl: string;
  hook: string;
  message: string;
  visualChanges: string[];
  expectedImprovement: string;
  confidence: number;
  focusMetric: string;
  provider: string;
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);
  private readonly apiKey: string;
  private readonly modelName: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('ai.googleAiApiKey') || '';
    this.modelName = this.configService.get<string>('ai.googleAiModel') || 'gemini-2.0-flash';
  }

  async analyzeCreative(data: {
    imageUrl: string;
    creativeId: string;
    adAccountId: string;
    creativeType?: string;
    accessToken?: string;
  }): Promise<AnalysisResult> {
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'Google AI Studio API key is not configured. Please add GOOGLE_AI_STUDIO_API_KEY to your environment variables.'
      );
    }

    // Tokenize Facebook CDN URLs
    let tokenizedUrl = data.imageUrl;
    let tokenizationApplied = false;
    const isFacebookUrl = this.isFacebookCdnUrl(data.imageUrl);

    if (isFacebookUrl && data.accessToken && !data.imageUrl.includes('access_token=')) {
      const separator = data.imageUrl.includes('?') ? '&' : '?';
      tokenizedUrl = `${data.imageUrl}${separator}access_token=${data.accessToken}`;
      tokenizationApplied = true;
    }

    // Fetch image and convert to base64
    const { base64Data, mimeType } = await this.fetchImageAsBase64(tokenizedUrl, sessionId);

    // Call Gemini Vision API
    const aiAnalysis = await this.callGeminiVisionApi(base64Data, mimeType, data.creativeType || 'image');

    return {
      success: true,
      score: Math.round(aiAnalysis.overallScore / 10),
      aiScore: Math.round(aiAnalysis.overallScore / 10),
      imageUrl: tokenizedUrl,
      originalImageUrl: data.imageUrl,
      tokenizationApplied,
      analysis: aiAnalysis.analysis,
      improvements: aiAnalysis.improvements,
      recommendations: aiAnalysis.recommendations,
      dimensions: aiAnalysis.dimensions,
      metadata: {
        sessionId,
        workflowVersion: '2.0-gemini',
        analyzedAt: new Date().toISOString(),
        aiService: 'google-gemini',
        model: this.modelName,
      },
    };
  }

  private async callGeminiVisionApi(
    base64Data: string,
    mimeType: string,
    creativeType: string,
  ): Promise<{
    overallScore: number;
    analysis: { main: string; detailed: string; strengths: string[]; issues: string[] };
    improvements: string[];
    recommendations: string[];
    dimensions: Record<string, number>;
  }> {
    const fullModelName = this.modelName.includes('/') ? this.modelName : `models/${this.modelName}`;
    const url = `https://generativelanguage.googleapis.com/v1/${fullModelName}:generateContent?key=${this.apiKey}`;

    const prompt = this.buildAnalysisPrompt();

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { inline_data: { mime_type: mimeType, data: base64Data } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.4,
          topK: 32,
          topP: 1,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Google Gemini API failed: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
    }

    const result = await response.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    const aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return this.transformGeminiResponse(aiResult);
  }

  private buildAnalysisPrompt(): string {
    return `You are an expert ad creative analyst. Analyze this Facebook/Instagram ad creative image and provide a comprehensive performance analysis.

Please analyze the following aspects and provide scores (0-100) for each:
1. Visual Appeal - How eye-catching and aesthetically pleasing is the creative?
2. Message Clarity - How clear and understandable is the message?
3. Brand Alignment - How well does it align with professional brand standards?
4. Call to Action - How effective and visible is the CTA?
5. Target Audience - How well targeted is this for the intended audience?
6. Mobile Optimization - How well will this perform on mobile devices?
7. Engagement Potential - Predicted engagement rate potential
8. Compliance - Adherence to platform advertising policies

Provide your response in this JSON format:
{
  "overall_score": <0-100>,
  "summary": "<brief 1-2 sentence summary>",
  "detailed_analysis": "<detailed paragraph analysis>",
  "dimensions": {
    "visual_appeal": <0-100>,
    "message_clarity": <0-100>,
    "brand_alignment": <0-100>,
    "call_to_action": <0-100>,
    "target_audience": <0-100>,
    "mobile_optimization": <0-100>,
    "engagement_potential": <0-100>,
    "compliance": <0-100>
  },
  "strengths": ["<strength 1>", "<strength 2>"],
  "issues": ["<issue 1>", "<issue 2>"],
  "improvements": ["<improvement 1>", "<improvement 2>"],
  "recommendations": ["<recommendation 1>", "<recommendation 2>"],
  "quick_wins": ["<quick win 1>", "<quick win 2>", "<quick win 3>"]
}`;
  }

  private transformGeminiResponse(aiResult: any): {
    overallScore: number;
    analysis: { main: string; detailed: string; strengths: string[]; issues: string[] };
    improvements: string[];
    recommendations: string[];
    dimensions: Record<string, number>;
  } {
    const overallScore = aiResult.overall_score || 75;
    const dimensions = aiResult.dimensions || {};

    return {
      overallScore,
      analysis: {
        main: aiResult.summary || `Creative scored ${overallScore}/100`,
        detailed: aiResult.detailed_analysis || 'AI analysis completed successfully',
        strengths: aiResult.strengths || [],
        issues: aiResult.issues || [],
      },
      improvements: aiResult.improvements || [],
      recommendations: aiResult.recommendations || aiResult.quick_wins || [],
      dimensions: {
        visualAppeal: dimensions.visual_appeal || overallScore,
        messageClarity: dimensions.message_clarity || overallScore,
        brandAlignment: dimensions.brand_alignment || overallScore,
        callToAction: dimensions.call_to_action || overallScore,
        targetAudience: dimensions.target_audience || overallScore,
        mobileOptimization: dimensions.mobile_optimization || overallScore,
        engagementPotential: dimensions.engagement_potential || overallScore,
        compliance: dimensions.compliance || overallScore,
      },
    };
  }

  private async fetchImageAsBase64(imageUrl: string, sessionId: string): Promise<{ base64Data: string; mimeType: string }> {
    try {
      const response = await fetch(imageUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        throw new Error(`URL did not return an image. Received content-type: ${contentType}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return { base64Data: base64, mimeType: contentType };
    } catch (error) {
      this.logger.error(`Failed to fetch image: ${error}`);
      throw error;
    }
  }

  private isFacebookCdnUrl(url: string): boolean {
    return (
      url.includes('fbcdn.net') ||
      url.includes('facebook.com') ||
      url.includes('instagram.com') ||
      url.includes('cdninstagram.com') ||
      url.includes('scontent.xx.fbcdn.net') ||
      url.includes('scontent.cdninstagram.com')
    );
  }
}
