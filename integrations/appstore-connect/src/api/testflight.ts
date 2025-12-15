/**
 * App Store Connect API - TestFlight
 */

import type {
  BetaTester,
  BetaGroup,
  BetaTesterFilters,
  BetaBuildLocalization,
} from '../types.js';
import type { AppStoreConnectClient } from './client.js';

/**
 * TestFlight API
 */
export class TestFlightAPI {
  constructor(private readonly client: AppStoreConnectClient) {}

  // ============================================
  // Beta Testers
  // ============================================

  /**
   * List beta testers for an app
   */
  async listTesters(
    appId: string,
    filters?: BetaTesterFilters,
    limit = 200
  ): Promise<BetaTester[]> {
    const params: Record<string, string | string[] | number | undefined> = {
      limit,
      'filter[apps]': appId,
    };

    if (filters?.email) {
      params['filter[email]'] = filters.email.join(',');
    }
    if (filters?.inviteType) {
      params['filter[inviteType]'] = filters.inviteType.join(',');
    }

    const response = await this.client.get<BetaTester[]>('/betaTesters', params);
    return Array.isArray(response.data) ? response.data : [response.data];
  }

  /**
   * Get beta tester by ID
   */
  async getTester(testerId: string): Promise<BetaTester> {
    const response = await this.client.get<BetaTester>(`/betaTesters/${testerId}`);
    return response.data;
  }

  /**
   * Invite a beta tester
   */
  async inviteTester(
    appId: string,
    email: string,
    firstName?: string,
    lastName?: string,
    groupIds?: string[]
  ): Promise<BetaTester> {
    const relationships: Record<string, unknown> = {
      apps: {
        data: [{ type: 'apps', id: appId }],
      },
    };

    if (groupIds && groupIds.length > 0) {
      relationships.betaGroups = {
        data: groupIds.map((id) => ({ type: 'betaGroups', id })),
      };
    }

    const response = await this.client.post<BetaTester>('/betaTesters', {
      data: {
        type: 'betaTesters',
        attributes: {
          email,
          firstName,
          lastName,
        },
        relationships,
      },
    });

    return response.data;
  }

  /**
   * Remove a beta tester
   */
  async removeTester(testerId: string): Promise<void> {
    await this.client.delete(`/betaTesters/${testerId}`);
  }

  // ============================================
  // Beta Groups
  // ============================================

  /**
   * List beta groups for an app
   */
  async listGroups(appId: string, limit = 200): Promise<BetaGroup[]> {
    const params: Record<string, string | number> = {
      limit,
      'filter[app]': appId,
    };

    const response = await this.client.get<BetaGroup[]>('/betaGroups', params);
    return Array.isArray(response.data) ? response.data : [response.data];
  }

  /**
   * Get beta group by ID
   */
  async getGroup(groupId: string): Promise<BetaGroup> {
    const response = await this.client.get<BetaGroup>(`/betaGroups/${groupId}`);
    return response.data;
  }

  /**
   * Create a beta group
   */
  async createGroup(
    appId: string,
    name: string,
    options?: {
      isInternalGroup?: boolean;
      hasAccessToAllBuilds?: boolean;
      publicLinkEnabled?: boolean;
      publicLinkLimit?: number;
      feedbackEnabled?: boolean;
    }
  ): Promise<BetaGroup> {
    const response = await this.client.post<BetaGroup>('/betaGroups', {
      data: {
        type: 'betaGroups',
        attributes: {
          name,
          isInternalGroup: options?.isInternalGroup ?? false,
          hasAccessToAllBuilds: options?.hasAccessToAllBuilds ?? false,
          publicLinkEnabled: options?.publicLinkEnabled ?? false,
          publicLinkLimit: options?.publicLinkLimit,
          feedbackEnabled: options?.feedbackEnabled ?? true,
        },
        relationships: {
          app: {
            data: { type: 'apps', id: appId },
          },
        },
      },
    });

    return response.data;
  }

  /**
   * Add testers to a group
   */
  async addTestersToGroup(groupId: string, testerIds: string[]): Promise<void> {
    await this.client.post(`/betaGroups/${groupId}/relationships/betaTesters`, {
      data: testerIds.map((id) => ({ type: 'betaTesters', id })),
    });
  }

  /**
   * Remove testers from a group
   */
  async removeTestersFromGroup(groupId: string, testerIds: string[]): Promise<void> {
    await this.client.delete(`/betaGroups/${groupId}/relationships/betaTesters`);
  }

  // ============================================
  // Build Distribution
  // ============================================

  /**
   * Distribute a build to a beta group
   */
  async distributeToGroup(buildId: string, groupId: string): Promise<void> {
    await this.client.post(`/betaGroups/${groupId}/relationships/builds`, {
      data: [{ type: 'builds', id: buildId }],
    });
  }

  /**
   * Distribute a build to multiple groups
   */
  async distributeToGroups(buildId: string, groupIds: string[]): Promise<void> {
    for (const groupId of groupIds) {
      await this.distributeToGroup(buildId, groupId);
    }
  }

  // ============================================
  // Beta Build Localizations (What's New)
  // ============================================

  /**
   * Get build localizations
   */
  async getBuildLocalizations(buildId: string): Promise<BetaBuildLocalization[]> {
    const response = await this.client.get<BetaBuildLocalization[]>(
      `/builds/${buildId}/betaBuildLocalizations`
    );
    return Array.isArray(response.data) ? response.data : [response.data];
  }

  /**
   * Create or update build localization (What's New)
   */
  async setBuildWhatsNew(
    buildId: string,
    locale: string,
    whatsNew: string
  ): Promise<BetaBuildLocalization> {
    // First check if localization exists
    const localizations = await this.getBuildLocalizations(buildId);
    const existing = localizations.find((l) => l.attributes.locale === locale);

    if (existing) {
      // Update existing
      const response = await this.client.patch<BetaBuildLocalization>(
        `/betaBuildLocalizations/${existing.id}`,
        {
          data: {
            type: 'betaBuildLocalizations',
            id: existing.id,
            attributes: { whatsNew },
          },
        }
      );
      return response.data;
    } else {
      // Create new
      const response = await this.client.post<BetaBuildLocalization>(
        '/betaBuildLocalizations',
        {
          data: {
            type: 'betaBuildLocalizations',
            attributes: {
              locale,
              whatsNew,
            },
            relationships: {
              build: {
                data: { type: 'builds', id: buildId },
              },
            },
          },
        }
      );
      return response.data;
    }
  }

  // ============================================
  // Beta App Review
  // ============================================

  /**
   * Submit build for beta app review (external testing)
   */
  async submitForBetaReview(buildId: string): Promise<void> {
    await this.client.post('/betaAppReviewSubmissions', {
      data: {
        type: 'betaAppReviewSubmissions',
        relationships: {
          build: {
            data: { type: 'builds', id: buildId },
          },
        },
      },
    });
  }
}
