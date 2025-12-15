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

    const normalizedFilters = {
      region: rawFilters.region ?? 'US',
      mediaType: rawFilters.mediaType ?? 'all',
      adType: rawFilters.adType ?? 'all',
      dateRange: rawFilters.dateRange ?? 'last_30d',
      minSpend: rawFilters.minSpend ?? '',
      maxSpend: rawFilters.maxSpend ?? '',
      publisherPlatforms: Array.isArray(rawFilters.publisherPlatforms) ? rawFilters.publisherPlatforms : [],
    };

    // Build search parameters
    const searchParams: Record<string, any> = {
      search_terms: searchQuery.trim(),
      limit: 100,
      ad_type: 'ALL',
      ad_active_status: 'ACTIVE',
    };

    // Region handling
    if (normalizedFilters.region && normalizedFilters.region !== 'all') {
      const countryCodes = Array.isArray(normalizedFilters.region)
        ? normalizedFilters.region.filter(c => c !== 'all')
        : [normalizedFilters.region];
      searchParams.ad_reached_countries = countryCodes.length > 0 ? countryCodes : ['US'];
    } else {
      searchParams.ad_reached_countries = ['US'];
    }

    // Media type
    if (normalizedFilters.mediaType && normalizedFilters.mediaType !== 'all') {
      searchParams.media_type = normalizedFilters.mediaType.toUpperCase();
    }

    // Ad type
    if (normalizedFilters.adType && normalizedFilters.adType !== 'all') {
      const adTypeMap: Record<string, string> = {
        political: 'POLITICAL_AND_ISSUE_ADS',
        issue: 'POLITICAL_AND_ISSUE_ADS',
        election: 'POLITICAL_AND_ISSUE_ADS',
        employment: 'EMPLOYMENT_ADS',
        financial: 'FINANCIAL_PRODUCTS_AND_SERVICES_ADS',
        housing: 'HOUSING_ADS',
      };
      searchParams.ad_type = adTypeMap[normalizedFilters.adType] || 'ALL';
    }

    // Date range
    if (normalizedFilters.dateRange && normalizedFilters.dateRange !== 'all') {
      const now = new Date();
      const startDate = new Date();
      const daysMap: Record<string, number> = {
        last_7d: 7,
        last_30d: 30,
        last_90d: 90,
        last_12m: 365,
      };
      startDate.setDate(now.getDate() - (daysMap[normalizedFilters.dateRange] || 30));
      searchParams.ad_delivery_date_min = startDate.toISOString().split('T')[0];
      searchParams.ad_delivery_date_max = now.toISOString().split('T')[0];
    }

    // Build URL
    const fields = [
      'id', 'page_id', 'page_name', 'ad_creation_time', 'ad_delivery_start_time',
      'ad_delivery_stop_time', 'ad_snapshot_url', 'currency', 'spend', 'impressions',
      'publisher_platforms', 'ad_creative_bodies', 'ad_creative_link_captions',
      'ad_creative_link_descriptions', 'ad_creative_link_titles', 'bylines',
    ].join(',');

    const queryParams = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        queryParams.append(key, JSON.stringify(value));
      } else {
        queryParams.append(key, String(value));
      }
    });
    queryParams.append('fields', fields);
    queryParams.append('access_token', accessToken);

    const url = `https://graph.facebook.com/${this.graphApiVersion}/ads_archive?${queryParams.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        
        if (errorData.error?.error_subcode === 2332002) {
          return {
            success: false,
            error: 'Ads Library API Access Required',
            message: 'Your app requires approval for the Ads Library API.',
          };
        }

        return {
          success: false,
          error: errorData.error?.message || 'Facebook API error',
        };
      }

      const data = await response.json();

      // Transform ads
      const transformedAds: TransformedAd[] = (data.data || []).map((ad: any) => {
        const spend = ad.spend || { lower_bound: '0', upper_bound: '0' };
        const impressions = ad.impressions || { lower_bound: '0', upper_bound: '0' };
        const spendValue = parseFloat(spend.lower_bound || '0');
        const impressionsValue = parseInt(impressions.lower_bound || '0');

        return {
          id: ad.id,
          adCreativeBody: ad.ad_creative_bodies?.[0] || '',
          adCreativeLinkTitle: ad.ad_creative_link_titles?.[0] || '',
          adCreativeLinkDescription: ad.ad_creative_link_descriptions?.[0] || '',
          adCreativeLinkCaption: ad.ad_creative_link_captions?.[0] || '',
          imageUrl: null,
          videoUrl: null,
          thumbnailUrl: null,
          pageName: ad.page_name || 'Unknown Page',
          pageId: ad.page_id || '',
          adDeliveryStartTime: ad.ad_delivery_start_time || ad.ad_creation_time || '',
          adDeliveryStopTime: ad.ad_delivery_stop_time || null,
          adSnapshotUrl: ad.ad_snapshot_url || `https://www.facebook.com/ads/library/?id=${ad.id}`,
          currency: ad.currency || 'USD',
          spend: { lowerBound: spend.lower_bound || '0', upperBound: spend.upper_bound || '0' },
          impressions: { lowerBound: impressions.lower_bound || '0', upperBound: impressions.upper_bound || '0' },
          publisherPlatforms: (ad.publisher_platforms || []).map((p: string) => p.toLowerCase()),
          mediaType: 'image' as const,
          status: ad.ad_delivery_stop_time ? 'INACTIVE' : 'ACTIVE',
          region: Array.isArray(normalizedFilters.region) ? normalizedFilters.region.join(', ') : normalizedFilters.region || 'US',
          disclaimer: ad.bylines || null,
          adType: null,
          adCategory: null,
          _meta: { spendValue, impressionsValue },
        };
      });

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
      searchQuery: string;
      filters?: AdsLibraryFilters;
      format?: 'csv' | 'json';
    },
    @Res() res: Response,
  ) {
    const { accessToken, searchQuery, filters = {}, format = 'csv' } = body;

    if (!accessToken) {
      throw new BadRequestException('Access token is required');
    }

    if (!searchQuery || searchQuery.trim() === '') {
      throw new BadRequestException('Search query is required');
    }

    // Build search params
    const searchParams: Record<string, any> = {
      search_terms: searchQuery.trim(),
      limit: 1000,
      ad_reached_countries: ['US'],
    };

    if (filters.region && filters.region !== 'all') {
      searchParams.ad_reached_countries = Array.isArray(filters.region) ? filters.region : [filters.region];
    }

    if (filters.dateRange && filters.dateRange !== 'all') {
      const now = new Date();
      const startDate = new Date();
      const daysMap: Record<string, number> = { last_7d: 7, last_30d: 30, last_90d: 90, last_12m: 365 };
      startDate.setDate(now.getDate() - (daysMap[filters.dateRange] || 30));
      searchParams.ad_delivery_date_min = startDate.toISOString().split('T')[0];
      searchParams.ad_delivery_date_max = now.toISOString().split('T')[0];
    }

    const queryParams = new URLSearchParams();
    Object.entries(searchParams).forEach(([key, value]) => {
      queryParams.append(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
    });
    queryParams.append('access_token', accessToken);

    const url = `https://graph.facebook.com/${this.graphApiVersion}/ads_archive?${queryParams.toString()}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        const errorData = await response.json();
        return res.status(response.status).json({
          success: false,
          error: errorData.error?.message || 'Facebook API error',
        });
      }

      const data = await response.json();
      const ads = (data.data || []).map((ad: any) => ({
        id: ad.id,
        pageName: ad.page_name || 'Unknown Page',
        pageId: ad.page_id || '',
        adCreativeBody: ad.ad_creative_bodies?.[0] || '',
        adCreativeLinkTitle: ad.ad_creative_link_titles?.[0] || '',
        adSnapshotUrl: ad.ad_snapshot_url || '',
        adDeliveryStartTime: ad.ad_delivery_start_time || '',
        adDeliveryStopTime: ad.ad_delivery_stop_time || '',
        currency: ad.currency || 'USD',
        spendLowerBound: ad.spend?.lower_bound || '0',
        spendUpperBound: ad.spend?.upper_bound || '0',
        impressionsLowerBound: ad.impressions?.lower_bound || '0',
        impressionsUpperBound: ad.impressions?.upper_bound || '0',
        publisherPlatforms: (ad.publisher_platforms || []).join(', '),
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
        const filename = `ads-library-${searchQuery.replace(/[^a-z0-9]/gi, '-')}-${new Date().toISOString().split('T')[0]}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(csvContent);
      }

      return res.json({
        success: true,
        searchQuery,
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
}
