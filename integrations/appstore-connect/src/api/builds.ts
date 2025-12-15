/**
 * App Store Connect API - Builds
 */

import type { Build, BuildFilters, BuildProcessingState } from '../types.js';
import type { AppStoreConnectClient } from './client.js';
import { TimeoutError } from '../utils/errors.js';

/**
 * Builds API
 */
export class BuildsAPI {
  constructor(private readonly client: AppStoreConnectClient) {}

  /**
   * List builds for an app
   */
  async list(appId: string, filters?: BuildFilters, limit = 100): Promise<Build[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      limit,
      'filter[app]': appId,
    };

    if (filters?.processingState) {
      params['filter[processingState]'] = filters.processingState.join(',');
    }
    if (filters?.version) {
      params['filter[version]'] = filters.version;
    }
    if (filters?.expired !== undefined) {
      params['filter[expired]'] = filters.expired;
    }

    // Sort by upload date descending
    params['sort'] = '-uploadedDate';

    const response = await this.client.get<Build[]>('/builds', params);
    return Array.isArray(response.data) ? response.data : [response.data];
  }

  /**
   * Get build by ID
   */
  async get(buildId: string): Promise<Build> {
    const response = await this.client.get<Build>(`/builds/${buildId}`);
    return response.data;
  }

  /**
   * Find build by version string
   */
  async findByVersion(appId: string, version: string): Promise<Build | null> {
    const builds = await this.list(appId, { version });
    return builds[0] || null;
  }

  /**
   * Get latest build for an app
   */
  async getLatest(appId: string): Promise<Build | null> {
    const builds = await this.list(appId, { expired: false }, 1);
    return builds[0] || null;
  }

  /**
   * Wait for build processing to complete
   */
  async waitForProcessing(
    buildId: string,
    options?: {
      timeoutMs?: number;
      pollIntervalMs?: number;
      onProgress?: (state: BuildProcessingState) => void;
    }
  ): Promise<Build> {
    const timeoutMs = options?.timeoutMs || 600000; // 10 minutes default
    const pollIntervalMs = options?.pollIntervalMs || 10000; // 10 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const build = await this.get(buildId);
      const state = build.attributes.processingState;

      options?.onProgress?.(state);

      if (state === 'VALID') {
        return build;
      }

      if (state === 'FAILED' || state === 'INVALID') {
        throw new Error(`Build processing failed: ${state}`);
      }

      // Still processing, wait and retry
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new TimeoutError('Build processing', timeoutMs);
  }

  /**
   * Expire a build
   */
  async expire(buildId: string): Promise<void> {
    await this.client.patch(`/builds/${buildId}`, {
      data: {
        type: 'builds',
        id: buildId,
        attributes: {
          expired: true,
        },
      },
    });
  }

  /**
   * Get build processing state
   */
  async getProcessingState(buildId: string): Promise<BuildProcessingState> {
    const build = await this.get(buildId);
    return build.attributes.processingState;
  }

  /**
   * Check if build is valid (processing complete and not expired)
   */
  async isValid(buildId: string): Promise<boolean> {
    const build = await this.get(buildId);
    return (
      build.attributes.processingState === 'VALID' &&
      !build.attributes.expired
    );
  }
}
