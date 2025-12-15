/**
 * App Store Connect API - Apps
 */

import type { App, AppVersion, AppFilters, Platform } from '../types.js';
import type { AppStoreConnectClient } from './client.js';

/**
 * Apps API
 */
export class AppsAPI {
  constructor(private readonly client: AppStoreConnectClient) {}

  /**
   * List all apps
   */
  async list(filters?: AppFilters, limit = 200): Promise<App[]> {
    const params: Record<string, string | string[] | number | undefined> = {
      limit,
    };

    if (filters?.bundleId) {
      params['filter[bundleId]'] = filters.bundleId.join(',');
    }
    if (filters?.name) {
      params['filter[name]'] = filters.name;
    }
    if (filters?.sku) {
      params['filter[sku]'] = filters.sku.join(',');
    }
    if (filters?.platform) {
      params['filter[appStoreVersions.platform]'] = filters.platform.join(',');
    }

    const response = await this.client.get<App[]>('/apps', params);
    return Array.isArray(response.data) ? response.data : [response.data];
  }

  /**
   * Get app by ID
   */
  async get(appId: string): Promise<App> {
    const response = await this.client.get<App>(`/apps/${appId}`);
    return response.data;
  }

  /**
   * Get app by bundle ID
   */
  async getByBundleId(bundleId: string): Promise<App | null> {
    const apps = await this.list({ bundleId: [bundleId] });
    return apps[0] || null;
  }

  /**
   * Get app versions
   */
  async getVersions(
    appId: string,
    options?: {
      platform?: Platform;
      limit?: number;
    }
  ): Promise<AppVersion[]> {
    const params: Record<string, string | number | undefined> = {
      limit: options?.limit || 100,
    };

    if (options?.platform) {
      params['filter[platform]'] = options.platform;
    }

    const response = await this.client.get<AppVersion[]>(
      `/apps/${appId}/appStoreVersions`,
      params
    );

    return Array.isArray(response.data) ? response.data : [response.data];
  }

  /**
   * Get latest version for platform
   */
  async getLatestVersion(
    appId: string,
    platform: Platform = 'IOS'
  ): Promise<AppVersion | null> {
    const versions = await this.getVersions(appId, { platform, limit: 1 });
    return versions[0] || null;
  }

  /**
   * Search apps by name
   */
  async search(query: string): Promise<App[]> {
    const apps = await this.list();
    const lowerQuery = query.toLowerCase();

    return apps.filter(
      (app) =>
        app.attributes.name.toLowerCase().includes(lowerQuery) ||
        app.attributes.bundleId.toLowerCase().includes(lowerQuery)
    );
  }
}
