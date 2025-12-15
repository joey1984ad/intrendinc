import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ShareableLink } from './entities/shareable-link.entity';
import { randomBytes } from 'crypto';

@Injectable()
export class ShareableLinksService {
  constructor(
    @InjectRepository(ShareableLink)
    private shareableLinkRepository: Repository<ShareableLink>,
  ) {}

  async createShareableLink(
    userId: number,
    adAccountId?: string,
    expiresInDays?: number,
    maxUses?: number,
  ): Promise<ShareableLink> {
    const token = randomBytes(32).toString('hex');
    let expiresAt: Date | undefined;
    if (expiresInDays && expiresInDays > 0) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expiresInDays);
    }

    const link = this.shareableLinkRepository.create({
      userId,
      token,
      adAccountId,
      expiresAt,
      maxUses: maxUses || undefined,
      isActive: true,
    });
    return this.shareableLinkRepository.save(link);
  }

  async getShareableLinkByToken(token: string): Promise<ShareableLink | null> {
    return this.shareableLinkRepository.findOne({
      where: { token, isActive: true },
      relations: ['user'],
    });
  }

  async validateShareableLink(token: string): Promise<{ valid: boolean; link?: ShareableLink; error?: string }> {
    const link = await this.getShareableLinkByToken(token);
    
    if (!link) {
      return { valid: false, error: 'Link not found or inactive' };
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      return { valid: false, error: 'Link has expired' };
    }

    if (link.maxUses !== null && link.usesCount >= link.maxUses) {
      return { valid: false, error: 'Link has reached maximum uses' };
    }

    return { valid: true, link };
  }

  async incrementShareableLinkUsage(token: string): Promise<number> {
    const link = await this.shareableLinkRepository.findOneBy({ token });
    if (link) {
      link.usesCount += 1;
      await this.shareableLinkRepository.save(link);
      return link.usesCount;
    }
    return 0;
  }

  async getShareableLinksByUserId(userId: number): Promise<ShareableLink[]> {
    return this.shareableLinkRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async revokeShareableLink(id: number, userId: number): Promise<ShareableLink | null> {
    const link = await this.shareableLinkRepository.findOneBy({ id, userId });
    if (link) {
      link.isActive = false;
      return this.shareableLinkRepository.save(link);
    }
    return null;
  }

  async deleteShareableLink(id: number, userId: number): Promise<void> {
    await this.shareableLinkRepository.delete({ id, userId });
  }
}
