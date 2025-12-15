import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AiCreativeScore } from './entities/ai-creative-score.entity';
import { AiGeneratedCreative } from './entities/ai-generated-creative.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AiService {
  constructor(
    @InjectRepository(AiCreativeScore)
    private aiCreativeScoreRepository: Repository<AiCreativeScore>,
    @InjectRepository(AiGeneratedCreative)
    private aiGeneratedCreativeRepository: Repository<AiGeneratedCreative>,
    private configService: ConfigService,
  ) {}

  // AI Creative Scores
  async saveAICreativeScore(
    creativeId: string,
    adAccountId: string,
    score: number,
    analysisData?: any,
  ): Promise<number> {
    let entity = await this.aiCreativeScoreRepository.findOneBy({ creativeId, adAccountId });
    if (entity) {
      entity.score = score;
      entity.analysisData = analysisData;
    } else {
      entity = this.aiCreativeScoreRepository.create({
        creativeId,
        adAccountId,
        score,
        analysisData,
      });
    }
    const saved = await this.aiCreativeScoreRepository.save(entity);
    return saved.id;
  }

  async getAICreativeScore(creativeId: string, adAccountId: string): Promise<AiCreativeScore | null> {
    return this.aiCreativeScoreRepository.findOne({
      where: { creativeId, adAccountId },
      order: { updatedAt: 'DESC' },
    });
  }

  // AI Generated Creatives - CREATE
  async saveAIGeneratedCreative(
    userId: number,
    creativeData: {
      adAccountId: string;
      adAccountName?: string;
      creativeName?: string;
      creativeType: string;
      imageUrl: string;
      videoUrl?: string;
      thumbnailUrl?: string;
      assets?: any;
      sourceCreativeId?: string;
      sourceCreativeUrl?: string;
      generationPrompt?: string;
      variationPlan?: any;
      analysisData?: any;
      optimizationGoals?: string[];
      sourcePerformance?: any;
      tags?: string[];
      notes?: string;
      status?: string;
    },
  ): Promise<number> {
    const creative = this.aiGeneratedCreativeRepository.create({
      userId,
      ...creativeData,
      status: creativeData.status || 'draft',
      thumbnailUrl: creativeData.thumbnailUrl || creativeData.imageUrl,
    });
    const saved = await this.aiGeneratedCreativeRepository.save(creative);
    return saved.id;
  }

  // AI Generated Creatives - READ (all for user)
  async getAIGeneratedCreatives(
    userId: number,
    options?: { adAccountId?: string; status?: string; limit?: number; offset?: number }
  ): Promise<{ creatives: AiGeneratedCreative[]; total: number }> {
    const where: any = { userId };
    
    if (options?.adAccountId) {
      where.adAccountId = options.adAccountId;
    }
    if (options?.status) {
      where.status = options.status;
    }

    const [creatives, total] = await this.aiGeneratedCreativeRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: options?.limit || 50,
      skip: options?.offset || 0,
    });

    return { creatives, total };
  }

  // AI Generated Creatives - READ (single)
  async getAIGeneratedCreative(id: number, userId: number): Promise<AiGeneratedCreative> {
    const creative = await this.aiGeneratedCreativeRepository.findOne({
      where: { id, userId },
    });
    
    if (!creative) {
      throw new NotFoundException(`Creative with ID ${id} not found`);
    }
    
    return creative;
  }

  // AI Generated Creatives - UPDATE
  async updateAIGeneratedCreative(
    id: number,
    userId: number,
    updateData: Partial<AiGeneratedCreative>,
  ): Promise<AiGeneratedCreative> {
    const creative = await this.getAIGeneratedCreative(id, userId);
    
    // Merge and save
    Object.assign(creative, updateData);
    return this.aiGeneratedCreativeRepository.save(creative);
  }

  // AI Generated Creatives - DELETE
  async deleteAIGeneratedCreative(id: number, userId: number): Promise<void> {
    const creative = await this.getAIGeneratedCreative(id, userId);
    await this.aiGeneratedCreativeRepository.remove(creative);
  }

  // AI Generated Creatives - BULK SAVE
  async bulkSaveAICreatives(
    userId: number,
    creativesData: Array<{
      adAccountId: string;
      adAccountName?: string;
      creativeName?: string;
      creativeType: string;
      imageUrl: string;
      videoUrl?: string;
      thumbnailUrl?: string;
      assets?: any;
      sourceCreativeId?: string;
      sourceCreativeUrl?: string;
      generationPrompt?: string;
      variationPlan?: any;
      analysisData?: any;
      optimizationGoals?: string[];
      sourcePerformance?: any;
      tags?: string[];
      notes?: string;
      status?: string;
    }>,
  ): Promise<number[]> {
    const creatives = creativesData.map(data =>
      this.aiGeneratedCreativeRepository.create({
        userId,
        ...data,
        status: data.status || 'draft',
        thumbnailUrl: data.thumbnailUrl || data.imageUrl,
      }),
    );

    const saved = await this.aiGeneratedCreativeRepository.save(creatives);
    return saved.map(c => c.id);
  }

  // Toggle favorite
  async toggleFavorite(id: number, userId: number): Promise<AiGeneratedCreative> {
    const creative = await this.getAIGeneratedCreative(id, userId);
    creative.isFavorite = !creative.isFavorite;
    return this.aiGeneratedCreativeRepository.save(creative);
  }
}

