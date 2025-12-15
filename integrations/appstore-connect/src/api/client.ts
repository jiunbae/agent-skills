/**
 * App Store Connect API Client
 *
 * Axios-based HTTP client with JWT authentication,
 * rate limiting, and retry logic.
 */

import axios, {
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import type { AppStoreConnectConfig, APIResponse, APIErrorResponse } from '../types.js';
import { JWTAuthManager } from '../auth/jwt-auth.js';
import {
  parseAPIError,
  RateLimitError,
  ConnectionError,
  isRetryableError,
} from '../utils/errors.js';

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30000;

/**
 * Rate Limiter
 */
class RateLimiter {
  private requests: number[] = [];

  async waitIfNeeded(): Promise<void> {
    const now = Date.now();

    // Remove requests outside the window
    this.requests = this.requests.filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS
    );

    if (this.requests.length >= MAX_REQUESTS_PER_WINDOW) {
      // Calculate wait time
      const oldestRequest = this.requests[0];
      const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestRequest);

      if (waitTime > 0) {
        console.log(`Rate limit approaching. Waiting ${waitTime}ms...`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }
    }

    this.requests.push(now);
  }

  getRemainingRequests(): number {
    const now = Date.now();
    this.requests = this.requests.filter(
      (time) => now - time < RATE_LIMIT_WINDOW_MS
    );
    return MAX_REQUESTS_PER_WINDOW - this.requests.length;
  }
}

/**
 * App Store Connect API Client
 */
export class AppStoreConnectClient {
  private readonly config: AppStoreConnectConfig;
  private readonly jwtAuth: JWTAuthManager;
  private readonly axios: AxiosInstance;
  private readonly rateLimiter: RateLimiter;

  constructor(config: AppStoreConnectConfig) {
    this.config = config;
    this.jwtAuth = new JWTAuthManager(config);
    this.rateLimiter = new RateLimiter();

    this.axios = axios.create({
      baseURL: config.apiBaseUrl,
      timeout: config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for auth headers
    this.axios.interceptors.request.use((requestConfig) => {
      const authHeaders = this.jwtAuth.getAuthHeaders();
      Object.entries(authHeaders).forEach(([key, value]) => {
        requestConfig.headers.set(key, value);
      });
      return requestConfig;
    });

    // Add response interceptor for logging
    if (config.verbose) {
      this.axios.interceptors.response.use(
        (response) => {
          console.log(`[API] ${response.config.method?.toUpperCase()} ${response.config.url} -> ${response.status}`);
          return response;
        },
        (error) => {
          if (error.response) {
            console.error(`[API] ${error.config?.method?.toUpperCase()} ${error.config?.url} -> ${error.response.status}`);
          }
          throw error;
        }
      );
    }
  }

  /**
   * Make a GET request
   */
  async get<T>(
    path: string,
    params?: Record<string, string | string[] | number | boolean | undefined>
  ): Promise<APIResponse<T>> {
    return this.request<T>({
      method: 'GET',
      url: path,
      params: this.cleanParams(params),
    });
  }

  /**
   * Make a POST request
   */
  async post<T>(
    path: string,
    data?: Record<string, unknown>
  ): Promise<APIResponse<T>> {
    return this.request<T>({
      method: 'POST',
      url: path,
      data,
    });
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(
    path: string,
    data?: Record<string, unknown>
  ): Promise<APIResponse<T>> {
    return this.request<T>({
      method: 'PATCH',
      url: path,
      data,
    });
  }

  /**
   * Make a DELETE request
   */
  async delete(path: string): Promise<void> {
    await this.request({
      method: 'DELETE',
      url: path,
    });
  }

  /**
   * Execute request with rate limiting and retry
   */
  private async request<T>(config: AxiosRequestConfig): Promise<APIResponse<T>> {
    let lastError: Error | null = null;
    let retryDelay = INITIAL_RETRY_DELAY_MS;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Wait for rate limiter
        await this.rateLimiter.waitIfNeeded();

        // Make request
        const response: AxiosResponse<APIResponse<T>> = await this.axios.request(config);

        // Check for rate limit headers
        this.checkRateLimitHeaders(response);

        return response.data;
      } catch (error) {
        // Parse error
        if (axios.isAxiosError(error)) {
          if (error.response) {
            const apiError = parseAPIError({
              status: error.response.status,
              data: error.response.data as APIErrorResponse,
            });

            // Handle rate limit with retry
            if (apiError instanceof RateLimitError) {
              const retryAfter = apiError.retryAfter || Math.ceil(retryDelay / 1000);
              console.warn(`Rate limited. Retrying after ${retryAfter}s...`);
              await new Promise((resolve) =>
                setTimeout(resolve, retryAfter * 1000)
              );
              continue;
            }

            // Check if retryable
            if (isRetryableError(apiError) && attempt < MAX_RETRIES) {
              lastError = apiError;
              console.warn(
                `Request failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying in ${retryDelay}ms...`
              );
              await new Promise((resolve) => setTimeout(resolve, retryDelay));
              retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
              continue;
            }

            throw apiError;
          }

          // Network error
          const connectionError = new ConnectionError(
            error.message || 'Network error',
            error
          );

          if (attempt < MAX_RETRIES) {
            lastError = connectionError;
            console.warn(
              `Connection error (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying...`
            );
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
            retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY_MS);
            continue;
          }

          throw connectionError;
        }

        throw error;
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Clean undefined values from params
   */
  private cleanParams(
    params?: Record<string, string | string[] | number | boolean | undefined>
  ): Record<string, string | string[] | number | boolean> | undefined {
    if (!params) return undefined;

    const cleaned: Record<string, string | string[] | number | boolean> = {};

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        cleaned[key] = value;
      }
    }

    return Object.keys(cleaned).length > 0 ? cleaned : undefined;
  }

  /**
   * Check rate limit headers
   */
  private checkRateLimitHeaders(response: AxiosResponse): void {
    const remaining = response.headers['x-ratelimit-remaining'];
    const limit = response.headers['x-ratelimit-limit'];

    if (remaining !== undefined && parseInt(remaining, 10) < 10) {
      console.warn(`Rate limit warning: ${remaining}/${limit} requests remaining`);
    }
  }

  /**
   * Get paginated results
   */
  async getAllPages<T>(
    path: string,
    params?: Record<string, string | string[] | number | boolean | undefined>,
    maxPages = 10
  ): Promise<T[]> {
    const results: T[] = [];
    let nextUrl: string | undefined = path;
    let pageCount = 0;

    while (nextUrl && pageCount < maxPages) {
      const pageResponse: APIResponse<T[]> = await this.get<T[]>(
        nextUrl,
        pageCount === 0 ? params : undefined
      );

      if (Array.isArray(pageResponse.data)) {
        results.push(...pageResponse.data);
      }

      nextUrl = pageResponse.links?.next;
      pageCount++;
    }

    return results;
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      await this.get('/apps', { limit: 1 });
      return {
        success: true,
        message: 'API connection successful',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get remaining rate limit
   */
  getRemainingRequests(): number {
    return this.rateLimiter.getRemainingRequests();
  }

  /**
   * Get JWT auth manager (for testing)
   */
  getJWTAuthManager(): JWTAuthManager {
    return this.jwtAuth;
  }
}

/**
 * Create API client from config
 */
export function createAPIClient(config: AppStoreConnectConfig): AppStoreConnectClient {
  return new AppStoreConnectClient(config);
}
