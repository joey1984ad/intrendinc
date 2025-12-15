import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  googleAiApiKey: process.env.GOOGLE_AI_STUDIO_API_KEY,
  googleAiModel: process.env.GOOGLE_AI_MODEL || 'gemini-2.0-flash',
  googleAiPlanModel: process.env.GOOGLE_AI_PLAN_MODEL || 'gemini-2.5-flash-lite',
  googleAiImageModel: process.env.GOOGLE_AI_IMAGE_MODEL || 'gemini-2.5-flash-image',
}));
