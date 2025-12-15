/**
 * Google Search Console API Client
 * Handles authentication and API requests
 */

import * as https from 'https';
import * as crypto from 'crypto';
import type {
  GoogleSearchConsoleConfig,
  ServiceAccountKey,
  SearchAnalyticsRequest,
  SearchAnalyticsResponse,
  UrlInspectionRequest,
  UrlInspectionResult,
  SitemapsListResponse,
  Sitemap,
  SitesListResponse,
  Site,
} from './types';
import { ConfigResolver } from './config';

// ============================================================================
// Constants
// ============================================================================

const API_BASE_URL = 'https://searchconsole.googleapis.com';
const WEBMASTERS_API_URL = 'https://www.googleapis.com/webmasters/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

// ============================================================================
// JWT Token Generation (for Service Account)
// ============================================================================

function base64UrlEncode(data: string | Buffer): string {
  const base64 = Buffer.from(data).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createJwt(serviceAccount: ServiceAccountKey, scope: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };
  const payload = {
    iss: serviceAccount.client_email,
    scope: scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600, // 1 hour
  };

  const headerBase64 = base64UrlEncode(JSON.stringify(header));
  const payloadBase64 = base64UrlEncode(JSON.stringify(payload));
  const signatureInput = `${headerBase64}.${payloadBase64}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(serviceAccount.private_key);
  const signatureBase64 = base64UrlEncode(signature);

  return `${signatureInput}.${signatureBase64}`;
}

// ============================================================================
// HTTP Helper
// ============================================================================

interface HttpResponse<T> {
  statusCode: number;
  data: T;
}

async function httpRequest<T>(
  url: string,
  options: https.RequestOptions & { body?: string }
): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode || 500,
            data: parsed as T,
          });
        } catch (error) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

// ============================================================================
// Google Search Console Client
// ============================================================================

export class GoogleSearchConsoleClient {
  private config: GoogleSearchConsoleConfig;
  private serviceAccountKey: ServiceAccountKey | null;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(config: GoogleSearchConsoleConfig) {
    this.config = config;
    this.serviceAccountKey = ConfigResolver.getServiceAccountKey(config);
  }

  /**
   * Get or refresh access token
   */
  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.tokenExpiry - 60000) {
      return this.accessToken;
    }

    if (this.serviceAccountKey) {
      return this.getServiceAccountToken();
    } else if (this.config.refreshToken) {
      return this.refreshOAuthToken();
    }

    throw new Error('No valid credentials available');
  }

  /**
   * Get token using service account
   */
  private async getServiceAccountToken(): Promise<string> {
    if (!this.serviceAccountKey) {
      throw new Error('Service account key not configured');
    }

    const jwt = createJwt(this.serviceAccountKey, SCOPE);
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString();

    const response = await httpRequest<{ access_token: string; expires_in: number }>(
      TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        body,
      }
    );

    if (response.statusCode !== 200) {
      throw new Error(`Failed to get access token: ${JSON.stringify(response.data)}`);
    }

    this.accessToken = response.data.access_token;
    this.tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return this.accessToken;
  }

  /**
   * Refresh OAuth token
   */
  private async refreshOAuthToken(): Promise<string> {
    if (!this.config.clientId || !this.config.clientSecret || !this.config.refreshToken) {
      throw new Error('OAuth credentials not configured');
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
    }).toString();

    const response = await httpRequest<{ access_token: string; expires_in: number }>(
      TOKEN_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        },
        body,
      }
    );

    if (response.statusCode !== 200) {
      throw new Error(`Failed to refresh token: ${JSON.stringify(response.data)}`);
    }

    this.accessToken = response.data.access_token;
    this.tokenExpiry = Date.now() + response.data.expires_in * 1000;
    return this.accessToken;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();
    const bodyStr = body ? JSON.stringify(body) : undefined;

    const response = await httpRequest<T & { error?: { message: string; code: number } }>(
      url,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(bodyStr && { 'Content-Length': Buffer.byteLength(bodyStr) }),
        },
        timeout: this.config.timeout || 30000,
        body: bodyStr,
      }
    );

    if (response.statusCode >= 400) {
      const error = response.data.error;
      throw new Error(
        error?.message || `API error: ${response.statusCode} - ${JSON.stringify(response.data)}`
      );
    }

    return response.data;
  }

  /**
   * Encode site URL for API path
   */
  private encodeSiteUrl(siteUrl: string): string {
    return encodeURIComponent(siteUrl);
  }

  // ==========================================================================
  // Search Analytics API
  // ==========================================================================

  /**
   * Query search analytics data
   */
  async querySearchAnalytics(
    siteUrl: string,
    request: SearchAnalyticsRequest
  ): Promise<SearchAnalyticsResponse> {
    const url = `${API_BASE_URL}/webmasters/v3/sites/${this.encodeSiteUrl(siteUrl)}/searchAnalytics/query`;
    return this.request<SearchAnalyticsResponse>('POST', url, request);
  }

  // ==========================================================================
  // URL Inspection API
  // ==========================================================================

  /**
   * Inspect a URL
   */
  async inspectUrl(request: UrlInspectionRequest): Promise<UrlInspectionResult> {
    const url = `${API_BASE_URL}/v1/urlInspection/index:inspect`;
    return this.request<UrlInspectionResult>('POST', url, request);
  }

  // ==========================================================================
  // Sitemaps API
  // ==========================================================================

  /**
   * List all sitemaps for a site
   */
  async listSitemaps(siteUrl: string): Promise<SitemapsListResponse> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}/sitemaps`;
    return this.request<SitemapsListResponse>('GET', url);
  }

  /**
   * Get a specific sitemap
   */
  async getSitemap(siteUrl: string, feedpath: string): Promise<Sitemap> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
    return this.request<Sitemap>('GET', url);
  }

  /**
   * Submit a sitemap
   */
  async submitSitemap(siteUrl: string, feedpath: string): Promise<void> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
    await this.request<void>('PUT', url);
  }

  /**
   * Delete a sitemap
   */
  async deleteSitemap(siteUrl: string, feedpath: string): Promise<void> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`;
    await this.request<void>('DELETE', url);
  }

  // ==========================================================================
  // Sites API
  // ==========================================================================

  /**
   * List all verified sites
   */
  async listSites(): Promise<SitesListResponse> {
    const url = `${WEBMASTERS_API_URL}/sites`;
    return this.request<SitesListResponse>('GET', url);
  }

  /**
   * Get site information
   */
  async getSite(siteUrl: string): Promise<Site> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}`;
    return this.request<Site>('GET', url);
  }

  /**
   * Add a site
   */
  async addSite(siteUrl: string): Promise<void> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}`;
    await this.request<void>('PUT', url);
  }

  /**
   * Remove a site
   */
  async removeSite(siteUrl: string): Promise<void> {
    const url = `${WEBMASTERS_API_URL}/sites/${this.encodeSiteUrl(siteUrl)}`;
    await this.request<void>('DELETE', url);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Test connection by listing sites
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.listSites();
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get default site URL from config
   */
  getDefaultSiteUrl(): string | undefined {
    return this.config.siteUrl;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createGoogleSearchConsoleClient(
  config?: GoogleSearchConsoleConfig
): GoogleSearchConsoleClient {
  const resolvedConfig = config || ConfigResolver.resolveFromEnv();
  return new GoogleSearchConsoleClient(resolvedConfig);
}
