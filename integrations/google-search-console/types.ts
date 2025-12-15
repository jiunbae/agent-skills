/**
 * Google Search Console API Types
 */

// ============================================================================
// Configuration Types
// ============================================================================

export interface GoogleSearchConsoleConfig {
  /** Service account key file path */
  serviceAccountKeyFile?: string;
  /** Service account key JSON (inline) */
  serviceAccountKeyJson?: string;
  /** OAuth client ID */
  clientId?: string;
  /** OAuth client secret */
  clientSecret?: string;
  /** OAuth refresh token */
  refreshToken?: string;
  /** Default site URL */
  siteUrl?: string;
  /** Request timeout in ms */
  timeout?: number;
}

export interface ServiceAccountKey {
  type: 'service_account';
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

// ============================================================================
// Search Analytics Types
// ============================================================================

export type Dimension = 'query' | 'page' | 'country' | 'device' | 'date' | 'searchAppearance';
export type SearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';
export type AggregationType = 'auto' | 'byPage' | 'byProperty';
export type DataState = 'all' | 'final';
export type FilterOperator = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'includingRegex' | 'excludingRegex';

export interface DimensionFilter {
  dimension: Dimension;
  operator: FilterOperator;
  expression: string;
}

export interface DimensionFilterGroup {
  groupType: 'and';
  filters: DimensionFilter[];
}

export interface SearchAnalyticsRequest {
  /** Start date (YYYY-MM-DD) */
  startDate: string;
  /** End date (YYYY-MM-DD) */
  endDate: string;
  /** Dimensions to group by */
  dimensions?: Dimension[];
  /** Search type */
  searchType?: SearchType;
  /** Filter groups */
  dimensionFilterGroups?: DimensionFilterGroup[];
  /** Aggregation type */
  aggregationType?: AggregationType;
  /** Max rows to return (max 25000) */
  rowLimit?: number;
  /** Starting row for pagination */
  startRow?: number;
  /** Data state */
  dataState?: DataState;
}

export interface SearchAnalyticsRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: AggregationType;
}

// ============================================================================
// URL Inspection Types
// ============================================================================

export interface UrlInspectionRequest {
  /** URL to inspect */
  inspectionUrl: string;
  /** Site URL (property) */
  siteUrl: string;
  /** Language code (e.g., 'en-US') */
  languageCode?: string;
}

export type IndexingState =
  | 'INDEXING_STATE_UNSPECIFIED'
  | 'INDEXING_ALLOWED'
  | 'BLOCKED_BY_META_TAG'
  | 'BLOCKED_BY_HTTP_HEADER'
  | 'BLOCKED_BY_ROBOTS_TXT';

export type PageFetchState =
  | 'PAGE_FETCH_STATE_UNSPECIFIED'
  | 'SUCCESSFUL'
  | 'SOFT_404'
  | 'BLOCKED_ROBOTS_TXT'
  | 'NOT_FOUND'
  | 'ACCESS_DENIED'
  | 'SERVER_ERROR'
  | 'REDIRECT_ERROR'
  | 'ACCESS_FORBIDDEN'
  | 'BLOCKED_4XX'
  | 'INTERNAL_CRAWL_ERROR'
  | 'INVALID_URL';

export type CrawledAs = 'CRAWLING_USER_AGENT_UNSPECIFIED' | 'DESKTOP' | 'MOBILE';

export type Verdict = 'VERDICT_UNSPECIFIED' | 'PASS' | 'PARTIAL' | 'FAIL' | 'NEUTRAL';

export type RobotsTxtState =
  | 'ROBOTS_TXT_STATE_UNSPECIFIED'
  | 'ALLOWED'
  | 'DISALLOWED';

export interface IndexStatusResult {
  verdict?: Verdict;
  coverageState?: string;
  robotsTxtState?: RobotsTxtState;
  indexingState?: IndexingState;
  lastCrawlTime?: string;
  pageFetchState?: PageFetchState;
  googleCanonical?: string;
  userCanonical?: string;
  sitemap?: string[];
  referringUrls?: string[];
  crawledAs?: CrawledAs;
}

export interface MobileUsabilityResult {
  verdict?: Verdict;
  issues?: MobileUsabilityIssue[];
}

export interface MobileUsabilityIssue {
  issueType?: string;
  severity?: 'SEVERITY_UNSPECIFIED' | 'WARNING' | 'ERROR';
  message?: string;
}

export interface RichResultsResult {
  verdict?: Verdict;
  detectedItems?: DetectedItem[];
}

export interface DetectedItem {
  richResultType?: string;
  items?: Item[];
}

export interface Item {
  name?: string;
  issues?: RichResultIssue[];
}

export interface RichResultIssue {
  issueMessage?: string;
  severity?: 'SEVERITY_UNSPECIFIED' | 'WARNING' | 'ERROR';
}

export interface UrlInspectionResult {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: IndexStatusResult;
    mobileUsabilityResult?: MobileUsabilityResult;
    richResultsResult?: RichResultsResult;
  };
}

// ============================================================================
// Sitemap Types
// ============================================================================

export type SitemapType =
  | 'notSitemap'
  | 'urlList'
  | 'sitemap'
  | 'rssFeed'
  | 'atomFeed'
  | 'patternSitemap';

export interface SitemapContent {
  type?: SitemapType;
  submitted?: string;
  indexed?: string;
}

export interface Sitemap {
  path?: string;
  lastSubmitted?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: SitemapType;
  lastDownloaded?: string;
  warnings?: string;
  errors?: string;
  contents?: SitemapContent[];
}

export interface SitemapsListResponse {
  sitemap?: Sitemap[];
}

// ============================================================================
// Sites Types
// ============================================================================

export type PermissionLevel =
  | 'siteUnverifiedUser'
  | 'siteRestrictedUser'
  | 'siteOwner'
  | 'siteFullUser';

export interface Site {
  siteUrl?: string;
  permissionLevel?: PermissionLevel;
}

export interface SitesListResponse {
  siteEntry?: Site[];
}

// ============================================================================
// Skill Types
// ============================================================================

export type SkillAction =
  | 'search_analytics'
  | 'url_inspection'
  | 'list_sitemaps'
  | 'submit_sitemap'
  | 'delete_sitemap'
  | 'list_sites'
  | 'add_site'
  | 'remove_site';

export interface SkillParams {
  action: SkillAction;
  siteUrl?: string;
  // Search Analytics params
  startDate?: string;
  endDate?: string;
  dimensions?: Dimension[];
  searchType?: SearchType;
  filters?: DimensionFilter[];
  rowLimit?: number;
  // URL Inspection params
  inspectionUrl?: string;
  // Sitemap params
  sitemapUrl?: string;
  // Output format
  outputFormat?: 'markdown' | 'json' | 'csv';
}

export type ErrorCategory =
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'connection'
  | 'timeout'
  | 'validation'
  | 'not_found'
  | 'api_error'
  | 'unknown';

export interface SkillResult {
  success: boolean;
  data?: FormattedResult;
  error?: {
    message: string;
    category: ErrorCategory;
    actionable: string;
    details?: unknown;
  };
  metadata: {
    duration: number;
    timestamp: string;
    correlationId: string;
  };
}

export interface FormattedResult {
  content: string;
  format: 'markdown' | 'json' | 'csv';
  metadata?: {
    rowCount?: number;
    queryTime?: number;
    [key: string]: unknown;
  };
}
