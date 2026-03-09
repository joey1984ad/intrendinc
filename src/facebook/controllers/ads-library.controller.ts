import { Controller, Get, Post, Body, Query, Param, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

interface AdsLibraryFilters {
  region?: string | string[];
  mediaType?: string;
  adType?: string;
  dateRange?: string;
  minSpend?: string;
  maxSpend?: string;
  publisherPlatforms?: string[];
}

interface TransformedAd {
  id: string;
  adCreativeBody: string;
  adCreativeLinkTitle: string;
  adCreativeLinkDescription?: string;
  adCreativeLinkCaption?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  thumbnailUrl?: string | null;
  pageName: string;
  pageId: string;
  adDeliveryStartTime: string;
  adDeliveryStopTime?: string | null;
  adSnapshotUrl: string;
  currency: string;
  spend: { lowerBound: string; upperBound: string };
  impressions: { lowerBound: string; upperBound: string };
  publisherPlatforms: string[];
  mediaType: 'image' | 'video' | 'carousel' | 'dynamic' | 'text';
  status: string;
  region: string;
  disclaimer: string | null;
  adType: string | null;
  adCategory: string | null;
  _meta?: { spendValue: number; impressionsValue: number };
}

@Controller('facebook/ads-library')
export class AdsLibraryController {
  private readonly graphApiVersion = 'v21.0';

  // POST /facebook/ads-library - Search ads library
  @Post()
  @UseGuards(JwtAuthGuard)
  async searchAdsLibrary(
    @Body() body: {
      accessToken: string;
      searchQuery?: string;
      filters?: AdsLibraryFilters;
      page?: number;
      pageSize?: number;
      adAccountId?: string;
    },
  ) {
    const {
      accessToken,
      searchQuery = '',
      filters: rawFilters = {},
      page = 1,
      pageSize = 20,
      adAccountId,
    } = body;

    if (!accessToken) {
      throw new BadRequestException('Access token is required');
    }

    if (!adAccountId) {
      throw new BadRequestException('Ad account ID is required');
    }

    const cleanAdAccountId = adAccountId.replace(/^act_/, '');

    const normalizedFilters = {
      region: rawFilters.region ?? 'US',
      mediaType: rawFilters.mediaType ?? 'all',
      adType: rawFilters.adType ?? 'all',
      dateRange: rawFilters.dateRange ?? 'last_30d',
      minSpend: rawFilters.minSpend ?? '',
      maxSpend: rawFilters.maxSpend ?? '',
      publisherPlatforms: Array.isArray(rawFilters.publisherPlatforms) ? rawFilters.publisherPlatforms : [],
    };

    const datePreset = this.mapDateRangeToDatePreset(normalizedFilters.dateRange);
    const fields = [
      'id',
      'name',
      'status',
      'preview_shareable_link',
      'campaign{name}',
      'adset{name}',
      'creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}',
      `insights.date_preset(${datePreset}){spend,impressions}`,
    ].join(',');

    try {
      const rawAds = await this.fetchAccountAdsInChunks({
        accessToken,
        adAccountId: cleanAdAccountId,
        fields,
        pageSize: 50,
        maxRequests: 6,
      });
      const transformedAds = this.transformAdAccountAds(rawAds, normalizedFilters, searchQuery);

      // Apply client-side filters
      const minSpendFilter = normalizedFilters.minSpend ? parseFloat(normalizedFilters.minSpend) : null;
      const maxSpendFilter = normalizedFilters.maxSpend ? parseFloat(normalizedFilters.maxSpend) : null;
      const requiredPlatforms = normalizedFilters.publisherPlatforms.map(p => p.toLowerCase());

      const filteredAds = transformedAds.filter(ad => {
        const spendAmount = ad._meta?.spendValue || 0;
        if (minSpendFilter !== null && spendAmount < minSpendFilter) return false;
        if (maxSpendFilter !== null && spendAmount > maxSpendFilter) return false;

        if (requiredPlatforms.length > 0) {
          const adPlatforms = ad.publisherPlatforms.map(p => p.toLowerCase());
          if (!requiredPlatforms.every(p => adPlatforms.includes(p))) return false;
        }

        return true;
      });

      // Pagination
      const totalResults = filteredAds.length;
      const totalPages = totalResults === 0 ? 1 : Math.ceil(totalResults / pageSize);
      const safePage = Math.min(Math.max(page, 1), totalPages);
      const startIndex = (safePage - 1) * pageSize;
      const paginatedAds = filteredAds.slice(startIndex, startIndex + pageSize);

      return {
        success: true,
        ads: paginatedAds,
        totalResults,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
        currentPage: safePage,
        pageSize,
        totalPages,
        searchQuery,
        appliedFilters: normalizedFilters,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  // GET /facebook/ads-library/:adId - Get specific ad details
  @Get(':adId')
  @UseGuards(JwtAuthGuard)
  async getAdById(
    @Param('adId') adId: string,
    @Query('access_token') accessToken: string,
  ) {
    if (!accessToken) {
      throw new BadRequestException('Access token is required');
    }

    if (!adId) {
      throw new BadRequestException('Ad ID is required');
    }

    const fields = 'id,ad_creative_body,ad_creative_link_title,ad_creative_link_description,ad_creative_link_caption,ad_snapshot_url,page_id,page_name,ad_delivery_start_time,ad_delivery_stop_time,currency,ad_spend,ad_reached_count,publisher_platforms,ad_type,ad_status,ad_reached_countries,disclaimer,ad_category';
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${adId}?fields=${fields}&access_token=${accessToken}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 404) {
          return { success: false, error: 'Ad not found' };
        }
        return {
          success: false,
          error: errorData.error?.message || 'Facebook API error',
        };
      }

      const ad = await response.json();

      const transformedAd = {
        id: ad.id,
        adCreativeBody: ad.ad_creative_body || '',
        adCreativeLinkTitle: ad.ad_creative_link_title || '',
        adCreativeLinkDescription: ad.ad_creative_link_description || '',
        adCreativeLinkCaption: ad.ad_creative_link_caption || '',
        imageUrl: ad.ad_snapshot_url ? `${ad.ad_snapshot_url}/image` : null,
        videoUrl: ad.ad_snapshot_url ? `${ad.ad_snapshot_url}/video` : null,
        thumbnailUrl: ad.ad_snapshot_url ? `${ad.ad_snapshot_url}/thumbnail` : null,
        pageName: ad.page_name || 'Unknown Page',
        pageId: ad.page_id || '',
        adDeliveryStartTime: ad.ad_delivery_start_time || '',
        adDeliveryStopTime: ad.ad_delivery_stop_time || null,
        adSnapshotUrl: ad.ad_snapshot_url || '',
        currency: ad.currency || 'USD',
        spend: {
          lowerBound: ad.ad_spend?.lower_bound || '0',
          upperBound: ad.ad_spend?.upper_bound || '0',
        },
        impressions: {
          lowerBound: ad.ad_reached_count?.lower_bound || '0',
          upperBound: ad.ad_reached_count?.upper_bound || '0',
        },
        publisherPlatforms: ad.publisher_platforms || [],
        mediaType: ad.ad_type?.toLowerCase() || 'image',
        status: ad.ad_status || 'ACTIVE',
        region: ad.ad_reached_countries?.[0] || 'US',
        disclaimer: ad.disclaimer || null,
        adType: ad.ad_type || null,
        adCategory: ad.ad_category || null,
      };

      return { success: true, ad: transformedAd };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      };
    }
  }

  // POST /facebook/ads-library/export - Export ads as CSV or JSON
  @Post('export')
  @UseGuards(JwtAuthGuard)
  async exportAds(
    @Body() body: {
      accessToken: string;
      searchQuery?: string;
      adAccountId: string;
      filters?: AdsLibraryFilters;
      format?: 'csv' | 'json';
    },
    @Res() res: Response,
  ) {
    const { accessToken, searchQuery = '', adAccountId, filters = {}, format = 'csv' } = body;

    if (!accessToken) {
      throw new BadRequestException('Access token is required');
    }

    if (!adAccountId) {
      throw new BadRequestException('Ad account ID is required');
    }

    const cleanAdAccountId = adAccountId.replace(/^act_/, '');
    const normalizedFilters = {
      region: filters.region ?? 'US',
      mediaType: filters.mediaType ?? 'all',
      adType: filters.adType ?? 'all',
      dateRange: filters.dateRange ?? 'last_30d',
      minSpend: filters.minSpend ?? '',
      maxSpend: filters.maxSpend ?? '',
      publisherPlatforms: Array.isArray(filters.publisherPlatforms) ? filters.publisherPlatforms : [],
    };
    const datePreset = this.mapDateRangeToDatePreset(normalizedFilters.dateRange);
    const fields = [
      'id',
      'name',
      'status',
      'preview_shareable_link',
      'campaign{name}',
      'adset{name}',
      'creative{id,name,title,body,thumbnail_url,image_url,video_id,object_story_spec,asset_feed_spec}',
      `insights.date_preset(${datePreset}){spend,impressions}`,
    ].join(',');
    const cleanQuery = (searchQuery || '').trim();

    try {
      const rawAds = await this.fetchAccountAdsInChunks({
        accessToken,
        adAccountId: cleanAdAccountId,
        fields,
        pageSize: 50,
        maxRequests: 12,
      });
      const transformedAds = this.transformAdAccountAds(rawAds, normalizedFilters, cleanQuery);
      const ads = transformedAds.map((ad) => ({
        id: ad.id,
        pageName: ad.pageName,
        pageId: ad.pageId,
        adCreativeBody: ad.adCreativeBody,
        adCreativeLinkTitle: ad.adCreativeLinkTitle,
        adSnapshotUrl: ad.adSnapshotUrl,
        adDeliveryStartTime: ad.adDeliveryStartTime,
        adDeliveryStopTime: ad.adDeliveryStopTime || '',
        currency: ad.currency || 'USD',
        spendLowerBound: ad.spend?.lowerBound || '0',
        spendUpperBound: ad.spend?.upperBound || '0',
        impressionsLowerBound: ad.impressions?.lowerBound || '0',
        impressionsUpperBound: ad.impressions?.upperBound || '0',
        publisherPlatforms: (ad.publisherPlatforms || []).join(', '),
      }));

      if (format === 'csv') {
        const headers = ['ID', 'Page Name', 'Page ID', 'Ad Body', 'Ad Title', 'Snapshot URL', 'Start Date', 'End Date', 'Currency', 'Min Spend', 'Max Spend', 'Min Impressions', 'Max Impressions', 'Platforms'];
        const csvRows = ads.map((ad: any) => [
          ad.id,
          `"${(ad.pageName || '').replace(/"/g, '""')}"`,
          ad.pageId,
          `"${(ad.adCreativeBody || '').replace(/"/g, '""').substring(0, 500)}"`,
          `"${(ad.adCreativeLinkTitle || '').replace(/"/g, '""')}"`,
          ad.adSnapshotUrl,
          ad.adDeliveryStartTime,
          ad.adDeliveryStopTime,
          ad.currency,
          ad.spendLowerBound,
          ad.spendUpperBound,
          ad.impressionsLowerBound,
          ad.impressionsUpperBound,
          ad.publisherPlatforms,
        ]);

        const csvContent = [headers, ...csvRows].map(row => row.join(',')).join('\n');
        const safeQuery = (cleanQuery || 'account').replace(/[^a-z0-9]/gi, '-');
        const filename = `ads-library-${safeQuery}-${new Date().toISOString().split('T')[0]}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvContent);
      }

      return res.json({
        success: true,
        searchQuery: cleanQuery,
        filters,
        totalResults: ads.length,
        ads,
        exportDate: new Date().toISOString(),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'An unexpected error occurred',
      });
    }
  }

  private mapDateRangeToDatePreset(dateRange: string): string {
    const presets: Record<string, string> = {
      last_7d: 'last_7d',
      last_14d: 'last_14d',
      last_30d: 'last_30d',
      last_60d: 'last_90d',
      last_90d: 'last_90d',
      this_month: 'this_month',
      last_month: 'last_month',
      last_12m: 'last_year',
      all: 'maximum',
    };
    return presets[dateRange] || 'last_30d';
  }

  private transformAdAccountAds(
    ads: any[],
    filters: {
      region: string | string[];
      mediaType: string;
      adType: string;
      dateRange: string;
      minSpend: string;
      maxSpend: string;
      publisherPlatforms: string[];
    },
    searchQuery: string,
  ): TransformedAd[] {
    const query = (searchQuery || '').trim().toLowerCase();
    const requiredPlatforms = (filters.publisherPlatforms || []).map((p) => p.toLowerCase());
    const minSpendFilter = filters.minSpend ? parseFloat(filters.minSpend) : null;
    const maxSpendFilter = filters.maxSpend ? parseFloat(filters.maxSpend) : null;

    const transformed: TransformedAd[] = (ads || []).map((ad: any) => {
      const insight = ad.insights?.data?.[0] || {};
      const spendValue = parseFloat(insight.spend || '0');
      const impressionsValue = parseInt(insight.impressions || '0', 10) || 0;
      const creative = ad.creative || {};

      const mediaType: TransformedAd['mediaType'] =
        creative.video_id || creative.object_story_spec?.video_data
          ? 'video'
          : creative.object_story_spec?.link_data?.child_attachments
            ? 'carousel'
            : creative.asset_feed_spec
              ? 'dynamic'
              : 'image';

      const adBody =
        creative.body ||
        creative.object_story_spec?.link_data?.message ||
        creative.object_story_spec?.video_data?.message ||
        '';
      const adTitle =
        creative.title ||
        creative.object_story_spec?.link_data?.name ||
        creative.name ||
        ad.name ||
        '';
      const adDescription =
        creative.object_story_spec?.link_data?.description ||
        creative.object_story_spec?.video_data?.title ||
        '';
      const adCaption = creative.object_story_spec?.link_data?.caption || '';
      const publisherPlatforms = ['facebook', 'instagram'];

      return {
        id: String(ad.id || ''),
        adCreativeBody: adBody,
        adCreativeLinkTitle: adTitle,
        adCreativeLinkDescription: adDescription,
        adCreativeLinkCaption: adCaption,
        imageUrl: creative.image_url || creative.thumbnail_url || null,
        videoUrl: null,
        thumbnailUrl: creative.thumbnail_url || creative.image_url || null,
        pageName: ad.campaign?.name || 'Your Ad Account',
        pageId: '',
        adDeliveryStartTime: ad.created_time || ad.updated_time || new Date().toISOString(),
        adDeliveryStopTime: null,
        adSnapshotUrl: ad.preview_shareable_link || `https://www.facebook.com/ads/library/?id=${ad.id}`,
        currency: 'USD',
        spend: { lowerBound: String(spendValue), upperBound: String(spendValue) },
        impressions: { lowerBound: String(impressionsValue), upperBound: String(impressionsValue) },
        publisherPlatforms,
        mediaType,
        status: String(ad.status || 'ACTIVE').toUpperCase(),
        region: Array.isArray(filters.region) ? filters.region.join(', ') : filters.region || 'US',
        disclaimer: null,
        adType: null,
        adCategory: null,
        _meta: { spendValue, impressionsValue },
      };
    });

    return transformed.filter((ad) => {
      const haystack = `${ad.adCreativeBody} ${ad.adCreativeLinkTitle} ${ad.pageName}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;

      if (filters.mediaType !== 'all' && ad.mediaType !== filters.mediaType) return false;
      if (minSpendFilter !== null && (ad._meta?.spendValue || 0) < minSpendFilter) return false;
      if (maxSpendFilter !== null && (ad._meta?.spendValue || 0) > maxSpendFilter) return false;
      if (requiredPlatforms.length > 0) {
        const adPlatforms = ad.publisherPlatforms.map((p) => p.toLowerCase());
        if (!requiredPlatforms.every((p) => adPlatforms.includes(p))) return false;
      }

      return true;
    });
  }

  private async fetchAccountAdsInChunks(params: {
    accessToken: string;
    adAccountId: string;
    fields: string;
    pageSize: number;
    maxRequests: number;
  }): Promise<any[]> {
    const { accessToken, adAccountId, fields, pageSize, maxRequests } = params;
    const collected: any[] = [];
    let afterCursor: string | undefined;

    for (let requestIndex = 0; requestIndex < maxRequests; requestIndex++) {
      const query = new URLSearchParams({
        fields,
        limit: String(pageSize),
        access_token: accessToken,
      });
      if (afterCursor) {
        query.set('after', afterCursor);
      }

      const url = `https://graph.facebook.com/${this.graphApiVersion}/act_${adAccountId}/ads?${query.toString()}`;
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const fbError = errorData?.error || {};
        const fbCode = fbError?.code;
        const fbMessage = String(fbError?.message || '');

        if (
          fbCode === 200 ||
          fbMessage.includes('ads_management') ||
          fbMessage.includes('ads_read')
        ) {
          throw new Error(
            'Facebook permissions missing: ad account owner must grant ads_read and ads_management.',
          );
        }

        throw new Error(fbMessage || 'Facebook API error');
      }

      const data = await response.json();
      const chunk = data.data || [];
      collected.push(...chunk);

      const nextCursor = data?.paging?.cursors?.after;
      if (!nextCursor || chunk.length === 0) {
        break;
      }
      afterCursor = nextCursor;
    }

    return collected;
  }
}
