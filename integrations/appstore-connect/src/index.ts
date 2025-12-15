/**
 * jelly-appstore-connect
 *
 * App Store Connect automation skill with hybrid API and browser support.
 */

// Types
export * from './types.js';

// Authentication
export {
  JWTAuthManager,
  createJWTAuthManager,
  SessionStore,
  createSessionStore,
  getDefaultSessionStore,
  BrowserAuthManager,
  createBrowserAuthManager,
} from './auth/index.js';

// API Client
export {
  AppStoreConnectClient,
  createAPIClient,
  AppsAPI,
  BuildsAPI,
  TestFlightAPI,
} from './api/index.js';

// Utils
export * from './utils/errors.js';
export * from './utils/config.js';

// CLI
export { runCLI } from './cli/index.js';

/**
 * Create a fully configured App Store Connect client
 */
import { loadAPIConfig } from './utils/config.js';
import { createAPIClient, AppStoreConnectClient } from './api/index.js';
import { AppsAPI } from './api/apps.js';
import { BuildsAPI } from './api/builds.js';
import { TestFlightAPI } from './api/testflight.js';

export interface AppStoreConnect {
  client: AppStoreConnectClient;
  apps: AppsAPI;
  builds: BuildsAPI;
  testflight: TestFlightAPI;
}

export function createAppStoreConnect(): AppStoreConnect {
  const config = loadAPIConfig();
  const client = createAPIClient(config);

  return {
    client,
    apps: new AppsAPI(client),
    builds: new BuildsAPI(client),
    testflight: new TestFlightAPI(client),
  };
}
