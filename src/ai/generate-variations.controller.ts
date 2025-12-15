import { Controller, Post, Body, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface VariationPlan {
  key: string;
  label: string;
  focusArea: string;
  metric: string;
  promptFocus: string;
  liftRange: [number, number];
  keywordHints: string[];
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
  supportingInsight?: string;
  provider: string;
  prompt?: string;
}

const DEFAULT_VARIATION_PLANS: VariationPlan[] = [
  {
    key: 'cta-uplift',
    label: 'Conversion Surge CTA',
    focusArea: 'call-to-action prominence and urgency',
    metric: 'Click-through rate',
    promptFocus: 'Design a high-converting marketing creative that makes the call-to-action button the hero.',
    liftRange: [12, 20],
    keywordHints: ['cta', 'conversion', 'button', 'action', 'signup', 'offer'],
  },
  {
    key: 'social-proof',
    label: 'Proof-Driven Trust Builder',
    focusArea: 'testimonial and credibility storytelling',
    metric: 'Conversion rate',
    promptFocus: 'Craft a polished creative that centers authentic social proof with testimonials and trust signals.',
    liftRange: [8, 16],
    keywordHints: ['social proof', 'testimonial', 'trust', 'reviews', 'evidence', 'credibility'],
  },
  {
    key: 'mobile-flow',
    label: 'Mobile Flow Optimizer',
    focusArea: 'mobile-first readability and scrolling experience',
    metric: 'Engagement rate',
    promptFocus: 'Produce a mobile-first layout with generous whitespace and large typography.',
    liftRange: [14, 24],
    keywordHints: ['mobile', 'scroll', 'responsive', 'thumb', 'phone', 'readability'],
  },
];

@Controller('generate-variations')
export class GenerateVariationsController {
  private readonly logger = new Logger(GenerateVariationsController.name);
  private readonly GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

  constructor(private configService: ConfigService) {}

  @Post()
  async generateVariations(@Body() body: {
    creativeId: string;
    originalImageUrl: string;
    analysisData?: any;
    creativeType?: string;
    currentPerformance?: any;
    optimizationGoals?: string[];
  }) {
    const startedAt = Date.now();
    const sessionId = `var_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const { creativeId, originalImageUrl, analysisData, creativeType, currentPerformance, optimizationGoals } = body;

    if (!creativeId || !originalImageUrl) {
      return {
        success: false,
        error: 'Missing required fields',
        message: 'creativeId and originalImageUrl are required.',
        sessionId,
      };
    }

    const apiKey = this.configService.get<string>('ai.googleAiApiKey');
    if (!apiKey) {
      return {
        success: false,
        error: 'Configuration error',
        message: 'GOOGLE_AI_STUDIO_API_KEY is not configured.',
        sessionId,
      };
    }

    try {
      const baseDescription = this.deriveBaseDescription(analysisData);
      const audienceContext = this.deriveAudienceContext(analysisData);
      const improvementNotes = this.collectUniqueStrings([
        ...(analysisData?.improvements || []),
        ...(analysisData?.issues || []),
        ...(optimizationGoals || []),
      ]);
      const insightNotes = this.collectUniqueStrings([
        ...(analysisData?.optimizationRecommendations || []),
        ...(analysisData?.recommendations || []),
      ]);

      const variationPlans = await this.generateVariationPlans({
        sessionId,
        apiKey,
        baseDescription,
        audienceContext,
        improvementNotes,
        insightNotes,
        creativeType,
        analysisData,
      });

      const variations: VariationResult[] = [];
      for (let planIndex = 0; planIndex < variationPlans.length; planIndex++) {
        const plan = variationPlans[planIndex];
        try {
          const variation = await this.buildVariation({
            sessionId,
            plan,
            planIndex,
            totalPlans: variationPlans.length,
            baseDescription,
            audienceContext,
            improvementNotes,
            insightNotes,
            creativeType,
            analysisData,
            originalImageUrl,
            apiKey,
          });
          variations.push(variation);
        } catch (error) {
          this.logger.error(`Failed to build variation ${plan.key}: ${error}`);
        }
      }

      return {
        success: true,
        sessionId,
        generatedAt: new Date().toISOString(),
        variationCount: variations.length,
        aiProvider: this.GEMINI_IMAGE_MODEL,
        processingTimeMs: Date.now() - startedAt,
        creativeId,
        creativeType,
        baseDescription,
        audienceContext,
        variationPlans,
        variations,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        error: 'Variation generation failed',
        message,
        sessionId,
        timestamp: new Date().toISOString(),
      };
    }
  }

  private async generateVariationPlans(context: {
    sessionId: string;
    apiKey: string;
    baseDescription: string;
    audienceContext: string;
    improvementNotes: string[];
    insightNotes: string[];
    creativeType?: string;
    analysisData?: any;
  }): Promise<VariationPlan[]> {
    const modelName = this.configService.get<string>('ai.googleAiPlanModel') || 'gemini-2.5-flash-lite';
    const fullModelName = modelName.includes('/') ? modelName : `models/${modelName}`;
    const url = `https://generativelanguage.googleapis.com/v1/${fullModelName}:generateContent?key=${context.apiKey}`;

    const prompt = this.buildPlanPrompt(context);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.35, topK: 32, topP: 0.95, maxOutputTokens: 2048 },
        }),
      });

      if (!response.ok) {
        return DEFAULT_VARIATION_PLANS;
      }

      const json = await response.json();
      const responseText = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsedPlans = this.parsePlanResponse(responseText);

      return parsedPlans.length > 0 ? parsedPlans.slice(0, 3) : DEFAULT_VARIATION_PLANS;
    } catch (error) {
      return DEFAULT_VARIATION_PLANS;
    }
  }

  private buildPlanPrompt(context: {
    baseDescription: string;
    audienceContext: string;
    improvementNotes: string[];
    insightNotes: string[];
    creativeType?: string;
  }): string {
    const improvementSection = context.improvementNotes.length
      ? context.improvementNotes.map(note => `- ${note}`).join('\n')
      : '- No specific improvement notes provided.';

    return `You are a senior performance creative strategist. Suggest 3 testing angles for a marketing creative.

Context:
- Base creative summary: ${context.baseDescription}
- Primary audience: ${context.audienceContext}
- Known problem areas:
${improvementSection}

Return a JSON array with exactly 3 objects:
{
  "key": "kebab-case-identifier",
  "label": "Human friendly variation title",
  "focusArea": "Specific creative element to overhaul",
  "metric": "Single growth metric to improve",
  "promptFocus": "Guidance for image generation model",
  "liftRange": [minPercent, maxPercent],
  "keywordHints": ["keyword", "keyword"]
}

Respond with JSON only.`;
  }

  private parsePlanResponse(responseText: string): VariationPlan[] {
    if (!responseText) return [];

    const cleaned = responseText.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end === -1) return [];

    try {
      const plans = JSON.parse(cleaned.slice(start, end + 1));
      return Array.isArray(plans) ? plans.map(p => ({
        key: p.key || 'variation',
        label: p.label || 'AI Variation',
        focusArea: p.focusArea || 'creative improvement',
        metric: p.metric || 'Conversion rate',
        promptFocus: p.promptFocus || 'Improve the creative',
        liftRange: Array.isArray(p.liftRange) ? [p.liftRange[0] || 10, p.liftRange[1] || 20] : [10, 20],
        keywordHints: Array.isArray(p.keywordHints) ? p.keywordHints : [],
      })) : [];
    } catch {
      return [];
    }
  }

  private async buildVariation(context: {
    sessionId: string;
    plan: VariationPlan;
    planIndex: number;
    totalPlans: number;
    baseDescription: string;
    audienceContext: string;
    improvementNotes: string[];
    insightNotes: string[];
    creativeType?: string;
    analysisData?: any;
    originalImageUrl: string;
    apiKey: string;
  }): Promise<VariationResult> {
    const { plan, planIndex, baseDescription, audienceContext, improvementNotes, insightNotes, originalImageUrl, apiKey, sessionId } = context;

    const focusImprovement = this.pickMatchingNote(improvementNotes, plan.keywordHints) || improvementNotes[0];
    const supportingInsight = this.pickMatchingNote(insightNotes, plan.keywordHints);

    const prompt = this.buildImagePrompt({
      plan,
      baseDescription,
      audienceContext,
      focusImprovement,
      supportingInsight,
      creativeType: context.creativeType,
    });

    const imageResponse = await this.callGeminiImageAPI({
      prompt,
      apiKey,
      sessionId,
      variationKey: plan.key,
      originalImageUrl,
    });

    const [minLift, maxLift] = plan.liftRange;
    const expectedImprovement = `Projected ${plan.metric}: +${minLift}% to +${maxLift}%`;
    const confidence = Math.min(94, Math.max(64, 78 + (1 - planIndex) * 3));

    return {
      id: `var_${sessionId}_${plan.key}`,
      key: plan.key,
      title: `${plan.label}${focusImprovement ? `: ${focusImprovement}` : ''}`,
      description: plan.promptFocus,
      imageUrl: imageResponse.imageUrl,
      hook: plan.key === 'social-proof' ? 'See why others trust us' : 'Act now and win fast',
      message: `A fresh angle for ${audienceContext}, highlighting ${plan.focusArea}.`,
      visualChanges: [plan.promptFocus, focusImprovement ? `Resolve: ${focusImprovement}` : ''].filter(Boolean),
      expectedImprovement,
      confidence,
      focusMetric: plan.metric,
      supportingInsight,
      provider: imageResponse.provider,
      prompt: imageResponse.prompt,
    };
  }

  private buildImagePrompt(context: {
    plan: VariationPlan;
    baseDescription: string;
    audienceContext: string;
    focusImprovement?: string;
    supportingInsight?: string;
    creativeType?: string;
  }): string {
    const { plan, baseDescription, audienceContext, focusImprovement, supportingInsight } = context;
    const focus = focusImprovement ? `Primary change: ${focusImprovement}.` : '';
    const insight = supportingInsight ? `Incorporate insight: ${supportingInsight}.` : '';

    return `You are a senior performance marketing designer creating a high-converting social ad image.

Original creative summary: ${baseDescription}
${focus}
${insight}

Audience: ${audienceContext}. ${plan.promptFocus}

Design principles:
- Create a complete ad composition with visual hierarchy designed to stop the scroll.
- The image must look like a sponsored post, not a stock photo.
- Integrate the product/subject naturally into a persuasive marketing context.
- Use lighting, depth, and layout to guide the eye towards the focal point.`;
  }

  private async callGeminiImageAPI(context: {
    prompt: string;
    apiKey: string;
    sessionId: string;
    variationKey: string;
    originalImageUrl?: string;
  }): Promise<{ imageUrl: string; provider: string; prompt: string }> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.GEMINI_IMAGE_MODEL}:generateContent?key=${context.apiKey}`;

    let requestParts: any[] = [{ text: context.prompt }];

    if (context.originalImageUrl) {
      try {
        const { base64Data, mimeType } = await this.fetchImageAsBase64(context.originalImageUrl);
        requestParts = [
          { inline_data: { mime_type: mimeType, data: base64Data } },
          { text: context.prompt },
        ];
      } catch (error) {
        // Continue with text-only prompt
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': context.apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: requestParts }],
        generationConfig: { responseModalities: ['IMAGE'], temperature: 0.65 },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini image generation failed: ${errorText}`);
    }

    const json = await response.json();
    const candidate = json?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const imagePart = parts.find((part: any) => part.inline_data?.data || part.inlineData?.data);
    const inlineData = imagePart?.inline_data || imagePart?.inlineData;

    if (!inlineData?.data) {
      throw new Error('Gemini response missing image data.');
    }

    const dataUrl = `data:${inlineData.mime_type || 'image/png'};base64,${inlineData.data}`;
    return {
      imageUrl: dataUrl,
      provider: this.GEMINI_IMAGE_MODEL,
      prompt: context.prompt,
    };
  }

  private async fetchImageAsBase64(imageUrl: string): Promise<{ base64Data: string; mimeType: string }> {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');
    return { base64Data: base64, mimeType: contentType };
  }

  private deriveBaseDescription(analysisData: any): string {
    return analysisData?.summary || analysisData?.analysis || 
      'High-performing performance marketing creative for a digital campaign.';
  }

  private deriveAudienceContext(analysisData: any): string {
    return analysisData?.audienceEngagement || analysisData?.targetAudience || 
      'growth-focused decision makers looking for proven solutions.';
  }

  private collectUniqueStrings(entries: unknown[]): string[] {
    const seen = new Set<string>();
    return entries
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .filter(entry => {
        const lower = entry.toLowerCase();
        if (seen.has(lower)) return false;
        seen.add(lower);
        return true;
      });
  }

  private pickMatchingNote(notes: string[], keywords: string[]): string | undefined {
    if (!notes.length) return undefined;
    for (const keyword of keywords) {
      const match = notes.find(note => note.toLowerCase().includes(keyword));
      if (match) return match;
    }
    return undefined;
  }
}
