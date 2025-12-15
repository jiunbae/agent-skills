/**
 * App Store Connect Skill - Type Definitions
 */

// ============================================
// Configuration Types
// ============================================

export interface AppStoreConnectConfig {
  /** App Store Connect API base URL */
  apiBaseUrl: string;
  /** Issuer ID for JWT authentication */
  issuerId: string;
  /** Key ID for JWT authentication */
  keyId: string;
  /** Path to private key file (.p8) */
  privateKeyPath?: string;
  /** Private key content (alternative to path) */
  privateKey?: string;
  /** Request timeout in milliseconds */
  timeout: number;
  /** Enable verbose logging */
  verbose: boolean;
}

export interface BrowserConfig {
  /** Run browser in headless mode */
  headless: boolean;
  /** Slow down actions for debugging */
  slowMo?: number;
  /** Browser viewport dimensions */
  viewport: {
    width: number;
    height: number;
  };
  /** Path to session storage file */
  sessionStoragePath: string;
  /** 2FA wait timeout in milliseconds */
  twoFactorTimeout: number;
}

// ============================================
// Authentication Types
// ============================================

export interface JWTPayload {
  iss: string;  // Issuer ID
  iat: number;  // Issued at
  exp: number;  // Expiration time
  aud: string;  // Audience (always 'appstoreconnect-v1')
}

export interface SessionState {
  /** Cookies from browser session */
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
  }>;
  /** Local storage entries */
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
  /** Session creation timestamp */
  createdAt: number;
  /** Session last used timestamp */
  lastUsedAt: number;
  /** Apple ID used for this session */
  appleId?: string;
}

export type AuthMethod = 'jwt' | 'browser';

// ============================================
// API Response Types
// ============================================

export interface APIResponse<T> {
  data: T;
  links?: {
    self: string;
    next?: string;
  };
  meta?: {
    paging?: {
      total: number;
      limit: number;
    };
  };
}

export interface APIError {
  id: string;
  status: string;
  code: string;
  title: string;
  detail: string;
  source?: {
    pointer?: string;
    parameter?: string;
  };
}

export interface APIErrorResponse {
  errors: APIError[];
}

// ============================================
// App Types
// ============================================

export interface App {
  type: 'apps';
  id: string;
  attributes: {
    name: string;
    bundleId: string;
    sku: string;
    primaryLocale: string;
    isOrEverWasMadeForKids: boolean;
    subscriptionStatusUrl?: string;
    subscriptionStatusUrlVersion?: string;
    subscriptionStatusUrlForSandbox?: string;
    subscriptionStatusUrlVersionForSandbox?: string;
    contentRightsDeclaration?: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' | 'USES_THIRD_PARTY_CONTENT';
    availableInNewTerritories: boolean;
  };
  relationships?: {
    appInfos?: { data: Array<{ type: string; id: string }> };
    appStoreVersions?: { data: Array<{ type: string; id: string }> };
    builds?: { data: Array<{ type: string; id: string }> };
    betaGroups?: { data: Array<{ type: string; id: string }> };
  };
}

export interface AppVersion {
  type: 'appStoreVersions';
  id: string;
  attributes: {
    platform: Platform;
    versionString: string;
    appStoreState: AppStoreState;
    appVersionState: AppVersionState;
    copyright?: string;
    reviewType?: 'STANDARD' | 'NOTARIZATION';
    releaseType?: 'MANUAL' | 'AFTER_APPROVAL' | 'SCHEDULED';
    earliestReleaseDate?: string;
    downloadable?: boolean;
    createdDate: string;
  };
}

export type Platform = 'IOS' | 'MAC_OS' | 'TV_OS' | 'VISION_OS';

export type AppStoreState =
  | 'ACCEPTED'
  | 'DEVELOPER_REJECTED'
  | 'DEVELOPER_REMOVED_FROM_SALE'
  | 'IN_REVIEW'
  | 'INVALID_BINARY'
  | 'METADATA_REJECTED'
  | 'PENDING_APPLE_RELEASE'
  | 'PENDING_CONTRACT'
  | 'PENDING_DEVELOPER_RELEASE'
  | 'PREPARE_FOR_SUBMISSION'
  | 'PREORDER_READY_FOR_SALE'
  | 'PROCESSING_FOR_APP_STORE'
  | 'READY_FOR_REVIEW'
  | 'READY_FOR_SALE'
  | 'REJECTED'
  | 'REMOVED_FROM_SALE'
  | 'WAITING_FOR_EXPORT_COMPLIANCE'
  | 'WAITING_FOR_REVIEW'
  | 'REPLACED_WITH_NEW_VERSION';

export type AppVersionState =
  | 'ACCEPTED'
  | 'DEVELOPER_REJECTED'
  | 'IN_REVIEW'
  | 'INVALID_BINARY'
  | 'METADATA_REJECTED'
  | 'PENDING_APPLE_RELEASE'
  | 'PENDING_DEVELOPER_RELEASE'
  | 'PREPARE_FOR_SUBMISSION'
  | 'PROCESSING_FOR_APP_STORE'
  | 'READY_FOR_REVIEW'
  | 'REJECTED'
  | 'REPLACED_WITH_NEW_VERSION'
  | 'WAITING_FOR_EXPORT_COMPLIANCE'
  | 'WAITING_FOR_REVIEW';

// ============================================
// Build Types
// ============================================

export interface Build {
  type: 'builds';
  id: string;
  attributes: {
    version: string;
    uploadedDate: string;
    expirationDate: string;
    expired: boolean;
    minOsVersion: string;
    lsMinimumSystemVersion?: string;
    computedMinMacOsVersion?: string;
    iconAssetToken?: IconAssetToken;
    processingState: BuildProcessingState;
    buildAudienceType?: 'INTERNAL_ONLY' | 'APP_STORE_ELIGIBLE';
    usesNonExemptEncryption?: boolean;
  };
  relationships?: {
    app?: { data: { type: string; id: string } };
    preReleaseVersion?: { data: { type: string; id: string } };
    betaBuildLocalizations?: { data: Array<{ type: string; id: string }> };
    buildBetaDetail?: { data: { type: string; id: string } };
  };
}

export type BuildProcessingState =
  | 'PROCESSING'
  | 'FAILED'
  | 'INVALID'
  | 'VALID';

export interface IconAssetToken {
  templateUrl: string;
  width: number;
  height: number;
}

// ============================================
// TestFlight Types
// ============================================

export interface BetaTester {
  type: 'betaTesters';
  id: string;
  attributes: {
    firstName?: string;
    lastName?: string;
    email: string;
    inviteType: 'EMAIL' | 'PUBLIC_LINK';
    state: BetaTesterState;
  };
  relationships?: {
    apps?: { data: Array<{ type: string; id: string }> };
    betaGroups?: { data: Array<{ type: string; id: string }> };
    builds?: { data: Array<{ type: string; id: string }> };
  };
}

export type BetaTesterState =
  | 'NOT_INVITED'
  | 'INVITED'
  | 'ACCEPTED'
  | 'INSTALLED';

export interface BetaGroup {
  type: 'betaGroups';
  id: string;
  attributes: {
    name: string;
    createdDate: string;
    isInternalGroup: boolean;
    hasAccessToAllBuilds?: boolean;
    publicLinkEnabled?: boolean;
    publicLinkId?: string;
    publicLinkLimitEnabled?: boolean;
    publicLinkLimit?: number;
    publicLink?: string;
    feedbackEnabled?: boolean;
    iosBuildsAvailableForAppleSiliconMac?: boolean;
  };
  relationships?: {
    app?: { data: { type: string; id: string } };
    betaTesters?: { data: Array<{ type: string; id: string }> };
    builds?: { data: Array<{ type: string; id: string }> };
  };
}

export interface BetaBuildLocalization {
  type: 'betaBuildLocalizations';
  id: string;
  attributes: {
    whatsNew?: string;
    locale: string;
  };
}

// ============================================
// Screenshot Types
// ============================================

export interface AppScreenshot {
  type: 'appScreenshots';
  id: string;
  attributes: {
    fileSize: number;
    fileName: string;
    sourceFileChecksum?: string;
    imageAsset?: {
      templateUrl: string;
      width: number;
      height: number;
    };
    assetToken?: string;
    assetType?: string;
    uploadOperations?: UploadOperation[];
    assetDeliveryState?: AssetDeliveryState;
  };
}

export interface UploadOperation {
  method: string;
  url: string;
  length: number;
  offset: number;
  requestHeaders: Array<{ name: string; value: string }>;
}

export interface AssetDeliveryState {
  state: 'AWAITING_UPLOAD' | 'UPLOAD_COMPLETE' | 'COMPLETE' | 'FAILED';
  errors?: APIError[];
}

export type ScreenshotDisplayType =
  | 'APP_IPHONE_35'
  | 'APP_IPHONE_40'
  | 'APP_IPHONE_47'
  | 'APP_IPHONE_55'
  | 'APP_IPHONE_58'
  | 'APP_IPHONE_61'
  | 'APP_IPHONE_65'
  | 'APP_IPHONE_67'
  | 'APP_IPAD_97'
  | 'APP_IPAD_105'
  | 'APP_IPAD_PRO_3GEN_11'
  | 'APP_IPAD_PRO_3GEN_129'
  | 'APP_IPAD_PRO_129'
  | 'APP_WATCH_SERIES_3'
  | 'APP_WATCH_SERIES_4'
  | 'APP_WATCH_SERIES_7'
  | 'APP_WATCH_ULTRA'
  | 'APP_APPLE_TV'
  | 'APP_DESKTOP'
  | 'IMESSAGE_APP_IPHONE_40'
  | 'IMESSAGE_APP_IPHONE_47'
  | 'IMESSAGE_APP_IPHONE_55'
  | 'IMESSAGE_APP_IPHONE_58'
  | 'IMESSAGE_APP_IPHONE_61'
  | 'IMESSAGE_APP_IPHONE_65'
  | 'IMESSAGE_APP_IPHONE_67'
  | 'IMESSAGE_APP_IPAD_97'
  | 'IMESSAGE_APP_IPAD_105'
  | 'IMESSAGE_APP_IPAD_PRO_3GEN_11'
  | 'IMESSAGE_APP_IPAD_PRO_3GEN_129'
  | 'IMESSAGE_APP_IPAD_PRO_129';

// ============================================
// Metadata Types
// ============================================

export interface AppStoreVersionLocalization {
  type: 'appStoreVersionLocalizations';
  id: string;
  attributes: {
    description?: string;
    locale: string;
    keywords?: string;
    marketingUrl?: string;
    promotionalText?: string;
    supportUrl?: string;
    whatsNew?: string;
  };
}

// ============================================
// Submission Types
// ============================================

export interface AppStoreVersionSubmission {
  type: 'appStoreVersionSubmissions';
  id: string;
  relationships?: {
    appStoreVersion?: { data: { type: string; id: string } };
  };
}

export interface ReviewSubmission {
  type: 'reviewSubmissions';
  id: string;
  attributes: {
    platform: Platform;
    state: ReviewSubmissionState;
    submittedDate?: string;
  };
}

export type ReviewSubmissionState =
  | 'CANCELING'
  | 'COMPLETE'
  | 'COMPLETING'
  | 'IN_REVIEW'
  | 'READY_FOR_REVIEW'
  | 'UNRESOLVED_ISSUES'
  | 'WAITING_FOR_REVIEW';

// ============================================
// CLI Types
// ============================================

export interface CLIOptions {
  json?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  timeout?: number;
  headed?: boolean;
}

export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ============================================
// Filter Types
// ============================================

export interface AppFilters {
  bundleId?: string[];
  name?: string;
  sku?: string[];
  appStoreVersionsAppStoreState?: AppStoreState[];
  platform?: Platform[];
}

export interface BuildFilters {
  appId?: string;
  processingState?: BuildProcessingState[];
  version?: string;
  preReleaseVersionVersion?: string;
  betaAppReviewSubmissionBetaReviewState?: string[];
  expired?: boolean;
}

export interface BetaTesterFilters {
  email?: string[];
  firstName?: string;
  lastName?: string;
  inviteType?: ('EMAIL' | 'PUBLIC_LINK')[];
  apps?: string[];
  betaGroups?: string[];
  builds?: string[];
}
