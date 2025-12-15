/**
 * Google Search Console Skill
 * Main entry point for Claude Code integration
 */

import type {
  GoogleSearchConsoleConfig,
  SkillParams,
  SkillResult,
  FormattedResult,
  ErrorCategory,
  SearchAnalyticsRequest,
  Dimension,
} from './types';
import { GoogleSearchConsoleClient, createGoogleSearchConsoleClient } from './client';
import { ConfigResolver, getGoogleSearchConsoleConfig } from './config';
import {
  formatSearchAnalyticsMarkdown,
  formatSearchAnalyticsJson,
  formatSearchAnalyticsCsv,
  formatUrlInspectionMarkdown,
  formatUrlInspectionJson,
  formatSitemapsMarkdown,
  formatSitemapsJson,
  formatSitesMarkdown,
  formatSitesJson,
} from './formatters';

// ============================================================================
// Main Skill Class
// ============================================================================

export class GoogleSearchConsoleSkill {
  private client: GoogleSearchConsoleClient;
  private config: GoogleSearchConsoleConfig;

  constructor(config?: GoogleSearchConsoleConfig) {
    this.config = config || getGoogleSearchConsoleConfig();
    this.client = createGoogleSearchConsoleClient(this.config);
  }

  /**
   * Execute a skill action
   */
  async execute(params: SkillParams): Promise<SkillResult> {
    const startTime = Date.now();
    const correlationId = this.generateCorrelationId();

    try {
      let data: FormattedResult;

      switch (params.action) {
        case 'search_analytics':
          data = await this.handleSearchAnalytics(params);
          break;
        case 'url_inspection':
          data = await this.handleUrlInspection(params);
          break;
        case 'list_sitemaps':
          data = await this.handleListSitemaps(params);
          break;
        case 'submit_sitemap':
          data = await this.handleSubmitSitemap(params);
          break;
        case 'delete_sitemap':
          data = await this.handleDeleteSitemap(params);
          break;
        case 'list_sites':
          data = await this.handleListSites(params);
          break;
        case 'add_site':
          data = await this.handleAddSite(params);
          break;
        case 'remove_site':
          data = await this.handleRemoveSite(params);
          break;
        default:
          throw new Error(`Unknown action: ${params.action}`);
      }

      return {
        success: true,
        data,
        metadata: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          correlationId,
        },
      };
    } catch (error) {
      const category = this.categorizeError(error);
      return {
        success: false,
        error: {
          message: this.formatError(error),
          category,
          actionable: this.getActionableMessage(error, category),
          details: error instanceof Error ? error.stack : undefined,
        },
        metadata: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          correlationId,
        },
      };
    }
  }

  // ==========================================================================
  // Action Handlers
  // ==========================================================================

  private async handleSearchAnalytics(params: SkillParams): Promise<FormattedResult> {
    const siteUrl = params.siteUrl || this.config.siteUrl;
    if (!siteUrl) {
      throw new Error('Site URL is required. Set GOOGLE_SEARCH_CONSOLE_SITE_URL or provide siteUrl parameter.');
    }

    // Default date range: last 7 days
    const endDate = params.endDate || this.getDateString(0);
    const startDate = params.startDate || this.getDateString(-7);

    const request: SearchAnalyticsRequest = {
      startDate,
      endDate,
      dimensions: params.dimensions || ['query'],
      searchType: params.searchType || 'web',
      rowLimit: params.rowLimit || 100,
    };

    // Add filters if provided
    if (params.filters && params.filters.length > 0) {
      request.dimensionFilterGroups = [
        {
          groupType: 'and',
          filters: params.filters,
        },
      ];
    }

    const response = await this.client.querySearchAnalytics(siteUrl, request);

    switch (params.outputFormat) {
      case 'json':
        return formatSearchAnalyticsJson(response);
      case 'csv':
        return formatSearchAnalyticsCsv(response, params.dimensions);
      default:
        return formatSearchAnalyticsMarkdown(response, params.dimensions, {
          title: `Search Analytics (${startDate} to ${endDate})`,
        });
    }
  }

  private async handleUrlInspection(params: SkillParams): Promise<FormattedResult> {
    const siteUrl = params.siteUrl || this.config.siteUrl;
    if (!siteUrl) {
      throw new Error('Site URL is required.');
    }
    if (!params.inspectionUrl) {
      throw new Error('Inspection URL is required.');
    }

    const result = await this.client.inspectUrl({
      inspectionUrl: params.inspectionUrl,
      siteUrl,
    });

    switch (params.outputFormat) {
      case 'json':
        return formatUrlInspectionJson(result);
      default:
        return formatUrlInspectionMarkdown(result);
    }
  }

  private async handleListSitemaps(params: SkillParams): Promise<FormattedResult> {
    const siteUrl = params.siteUrl || this.config.siteUrl;
    if (!siteUrl) {
      throw new Error('Site URL is required.');
    }

    const response = await this.client.listSitemaps(siteUrl);

    switch (params.outputFormat) {
      case 'json':
        return formatSitemapsJson(response);
      default:
        return formatSitemapsMarkdown(response);
    }
  }

  private async handleSubmitSitemap(params: SkillParams): Promise<FormattedResult> {
    const siteUrl = params.siteUrl || this.config.siteUrl;
    if (!siteUrl) {
      throw new Error('Site URL is required.');
    }
    if (!params.sitemapUrl) {
      throw new Error('Sitemap URL is required.');
    }

    await this.client.submitSitemap(siteUrl, params.sitemapUrl);

    return {
      content: `## Sitemap Submitted\n\n✅ Successfully submitted sitemap: ${params.sitemapUrl}`,
      format: 'markdown',
    };
  }

  private async handleDeleteSitemap(params: SkillParams): Promise<FormattedResult> {
    const siteUrl = params.siteUrl || this.config.siteUrl;
    if (!siteUrl) {
      throw new Error('Site URL is required.');
    }
    if (!params.sitemapUrl) {
      throw new Error('Sitemap URL is required.');
    }

    await this.client.deleteSitemap(siteUrl, params.sitemapUrl);

    return {
      content: `## Sitemap Deleted\n\n✅ Successfully deleted sitemap: ${params.sitemapUrl}`,
      format: 'markdown',
    };
  }

  private async handleListSites(params: SkillParams): Promise<FormattedResult> {
    const response = await this.client.listSites();

    switch (params.outputFormat) {
      case 'json':
        return formatSitesJson(response);
      default:
        return formatSitesMarkdown(response);
    }
  }

  private async handleAddSite(params: SkillParams): Promise<FormattedResult> {
    if (!params.siteUrl) {
      throw new Error('Site URL is required.');
    }

    await this.client.addSite(params.siteUrl);

    return {
      content: `## Site Added\n\n✅ Successfully added site: ${params.siteUrl}`,
      format: 'markdown',
    };
  }

  private async handleRemoveSite(params: SkillParams): Promise<FormattedResult> {
    if (!params.siteUrl) {
      throw new Error('Site URL is required.');
    }

    await this.client.removeSite(params.siteUrl);

    return {
      content: `## Site Removed\n\n✅ Successfully removed site: ${params.siteUrl}`,
      format: 'markdown',
    };
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Test connection to Google Search Console
   */
  async testConnection(): Promise<boolean> {
    return this.client.testConnection();
  }

  /**
   * Get configuration summary (redacted)
   */
  getConfigSummary(): Record<string, unknown> {
    return ConfigResolver.getSafeSummary(this.config);
  }

  private generateCorrelationId(): string {
    return `gsc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private getDateString(daysOffset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private categorizeError(error: unknown): ErrorCategory {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    if (message.includes('401') || message.includes('unauthorized') || message.includes('invalid credentials')) {
      return 'authentication';
    }
    if (message.includes('403') || message.includes('forbidden') || message.includes('permission')) {
      return 'authorization';
    }
    if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
      return 'rate_limit';
    }
    if (message.includes('404') || message.includes('not found')) {
      return 'not_found';
    }
    if (message.includes('timeout')) {
      return 'timeout';
    }
    if (message.includes('network') || message.includes('connection') || message.includes('econnrefused')) {
      return 'connection';
    }
    if (message.includes('invalid') || message.includes('required') || message.includes('validation')) {
      return 'validation';
    }

    return 'unknown';
  }

  private getActionableMessage(error: unknown, category: ErrorCategory): string {
    switch (category) {
      case 'authentication':
        return 'Verify your Google credentials. Check GOOGLE_SERVICE_ACCOUNT_KEY_FILE or OAuth tokens.';
      case 'authorization':
        return 'Add your service account email to Search Console: Settings → Users and permissions.';
      case 'rate_limit':
        return 'Rate limit reached. Wait a few minutes and try again.';
      case 'not_found':
        return 'Site or resource not found. Verify the site URL is correct and added to Search Console.';
      case 'timeout':
        return 'Request timed out. Try again or increase GSC_TIMEOUT setting.';
      case 'connection':
        return 'Connection failed. Check your internet connection.';
      case 'validation':
        return 'Invalid parameters. Check date format (YYYY-MM-DD) and required fields.';
      default:
        return 'An unexpected error occurred. Check the error details for more information.';
    }
  }
}

// ============================================================================
// Factory Functions & Convenience Methods
// ============================================================================

/**
 * Create a Google Search Console skill instance
 */
export function createGoogleSearchConsoleSkill(config?: GoogleSearchConsoleConfig): GoogleSearchConsoleSkill {
  return new GoogleSearchConsoleSkill(config);
}

/**
 * Query search analytics (convenience function)
 */
export async function querySearchAnalytics(
  siteUrl: string,
  options?: {
    startDate?: string;
    endDate?: string;
    dimensions?: Dimension[];
    rowLimit?: number;
  }
): Promise<SkillResult> {
  const skill = createGoogleSearchConsoleSkill();
  return skill.execute({
    action: 'search_analytics',
    siteUrl,
    ...options,
  });
}

/**
 * Inspect URL (convenience function)
 */
export async function inspectUrl(siteUrl: string, inspectionUrl: string): Promise<SkillResult> {
  const skill = createGoogleSearchConsoleSkill();
  return skill.execute({
    action: 'url_inspection',
    siteUrl,
    inspectionUrl,
  });
}

/**
 * List sitemaps (convenience function)
 */
export async function listSitemaps(siteUrl: string): Promise<SkillResult> {
  const skill = createGoogleSearchConsoleSkill();
  return skill.execute({
    action: 'list_sitemaps',
    siteUrl,
  });
}

/**
 * List sites (convenience function)
 */
export async function listSites(): Promise<SkillResult> {
  const skill = createGoogleSearchConsoleSkill();
  return skill.execute({
    action: 'list_sites',
  });
}

// ============================================================================
// Type Exports
// ============================================================================

export type {
  GoogleSearchConsoleConfig,
  SkillParams,
  SkillResult,
  FormattedResult,
  ErrorCategory,
  SearchAnalyticsRequest,
  SearchAnalyticsResponse,
  UrlInspectionResult,
  Dimension,
} from './types';
