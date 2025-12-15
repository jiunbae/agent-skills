/**
 * Google Search Console Result Formatters
 * Converts API responses to various output formats
 */

import type {
  SearchAnalyticsResponse,
  SearchAnalyticsRow,
  UrlInspectionResult,
  SitemapsListResponse,
  Sitemap,
  SitesListResponse,
  Site,
  FormattedResult,
  Dimension,
  Verdict,
} from './types';

// ============================================================================
// Helper Functions
// ============================================================================

function formatNumber(num: number, decimals: number = 0): string {
  if (decimals === 0) {
    return num.toLocaleString();
  }
  return num.toFixed(decimals);
}

function formatPercent(num: number): string {
  return `${(num * 100).toFixed(2)}%`;
}

function formatPosition(num: number): string {
  return num.toFixed(1);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  try {
    const date = new Date(dateStr);
    return date.toISOString().split('T')[0];
  } catch {
    return dateStr;
  }
}

function verdictIcon(verdict?: Verdict): string {
  switch (verdict) {
    case 'PASS':
      return '✅';
    case 'PARTIAL':
      return '⚠️';
    case 'FAIL':
      return '❌';
    case 'NEUTRAL':
      return '⚪';
    default:
      return '❓';
  }
}

function verdictText(verdict?: Verdict): string {
  switch (verdict) {
    case 'PASS':
      return 'Pass';
    case 'PARTIAL':
      return 'Partial';
    case 'FAIL':
      return 'Fail';
    case 'NEUTRAL':
      return 'Neutral';
    default:
      return 'Unknown';
  }
}

// ============================================================================
// Search Analytics Formatters
// ============================================================================

export function formatSearchAnalyticsMarkdown(
  response: SearchAnalyticsResponse,
  dimensions: Dimension[] = [],
  options?: { title?: string }
): FormattedResult {
  const rows = response.rows || [];
  const title = options?.title || 'Search Analytics Results';

  if (rows.length === 0) {
    return {
      content: `## ${title}\n\nNo data found for the specified query.`,
      format: 'markdown',
      metadata: { rowCount: 0 },
    };
  }

  // Calculate totals
  const totals = rows.reduce(
    (acc, row) => ({
      clicks: acc.clicks + row.clicks,
      impressions: acc.impressions + row.impressions,
      ctr: 0, // Will calculate after
      position: acc.position + row.position * row.impressions, // Weighted average
    }),
    { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  );

  totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  totals.position = totals.impressions > 0 ? totals.position / totals.impressions : 0;

  // Build markdown
  let content = `## ${title}\n\n`;

  // Summary section
  content += `### Summary\n\n`;
  content += `| Metric | Value |\n`;
  content += `|--------|-------|\n`;
  content += `| Total Clicks | ${formatNumber(totals.clicks)} |\n`;
  content += `| Total Impressions | ${formatNumber(totals.impressions)} |\n`;
  content += `| Average CTR | ${formatPercent(totals.ctr)} |\n`;
  content += `| Average Position | ${formatPosition(totals.position)} |\n`;
  content += `\n`;

  // Data table
  content += `### Details\n\n`;

  // Build header based on dimensions
  const headers = [...dimensions.map((d) => d.charAt(0).toUpperCase() + d.slice(1)), 'Clicks', 'Impressions', 'CTR', 'Position'];
  content += `| ${headers.join(' | ')} |\n`;
  content += `|${headers.map(() => '---').join('|')}|\n`;

  // Build rows (limit to first 50 for readability)
  const displayRows = rows.slice(0, 50);
  for (const row of displayRows) {
    const values = [
      ...row.keys,
      formatNumber(row.clicks),
      formatNumber(row.impressions),
      formatPercent(row.ctr),
      formatPosition(row.position),
    ];
    content += `| ${values.join(' | ')} |\n`;
  }

  if (rows.length > 50) {
    content += `\n*Showing 50 of ${rows.length} rows*\n`;
  }

  return {
    content,
    format: 'markdown',
    metadata: { rowCount: rows.length },
  };
}

export function formatSearchAnalyticsJson(response: SearchAnalyticsResponse): FormattedResult {
  return {
    content: JSON.stringify(response, null, 2),
    format: 'json',
    metadata: { rowCount: response.rows?.length || 0 },
  };
}

export function formatSearchAnalyticsCsv(
  response: SearchAnalyticsResponse,
  dimensions: Dimension[] = []
): FormattedResult {
  const rows = response.rows || [];

  if (rows.length === 0) {
    return {
      content: 'No data',
      format: 'csv',
      metadata: { rowCount: 0 },
    };
  }

  // Build header
  const headers = [...dimensions, 'clicks', 'impressions', 'ctr', 'position'];
  let content = headers.join(',') + '\n';

  // Build rows
  for (const row of rows) {
    const values = [
      ...row.keys.map((k) => `"${k.replace(/"/g, '""')}"`),
      row.clicks,
      row.impressions,
      row.ctr,
      row.position,
    ];
    content += values.join(',') + '\n';
  }

  return {
    content,
    format: 'csv',
    metadata: { rowCount: rows.length },
  };
}

// ============================================================================
// URL Inspection Formatters
// ============================================================================

export function formatUrlInspectionMarkdown(result: UrlInspectionResult): FormattedResult {
  const inspection = result.inspectionResult;
  if (!inspection) {
    return {
      content: '## URL Inspection\n\nNo inspection result available.',
      format: 'markdown',
    };
  }

  const index = inspection.indexStatusResult;
  const mobile = inspection.mobileUsabilityResult;
  const rich = inspection.richResultsResult;

  let content = `## URL Inspection Result\n\n`;

  // Index Status
  content += `### Index Status\n\n`;
  content += `| Property | Value |\n`;
  content += `|----------|-------|\n`;
  content += `| Verdict | ${verdictIcon(index?.verdict)} ${verdictText(index?.verdict)} |\n`;
  content += `| Coverage State | ${index?.coverageState || '-'} |\n`;
  content += `| Robots.txt | ${index?.robotsTxtState || '-'} |\n`;
  content += `| Indexing State | ${index?.indexingState || '-'} |\n`;
  content += `| Last Crawl | ${formatDate(index?.lastCrawlTime)} |\n`;
  content += `| Crawled As | ${index?.crawledAs || '-'} |\n`;
  content += `| Page Fetch | ${index?.pageFetchState || '-'} |\n`;

  if (index?.googleCanonical) {
    content += `| Google Canonical | ${index.googleCanonical} |\n`;
  }
  if (index?.userCanonical) {
    content += `| User Canonical | ${index.userCanonical} |\n`;
  }
  content += `\n`;

  // Mobile Usability
  if (mobile) {
    content += `### Mobile Usability\n\n`;
    content += `| Property | Value |\n`;
    content += `|----------|-------|\n`;
    content += `| Verdict | ${verdictIcon(mobile.verdict)} ${verdictText(mobile.verdict)} |\n`;

    if (mobile.issues && mobile.issues.length > 0) {
      content += `\n**Issues:**\n`;
      for (const issue of mobile.issues) {
        content += `- ${issue.severity}: ${issue.message || issue.issueType}\n`;
      }
    }
    content += `\n`;
  }

  // Rich Results
  if (rich) {
    content += `### Rich Results\n\n`;
    content += `| Property | Value |\n`;
    content += `|----------|-------|\n`;
    content += `| Verdict | ${verdictIcon(rich.verdict)} ${verdictText(rich.verdict)} |\n`;

    if (rich.detectedItems && rich.detectedItems.length > 0) {
      content += `\n**Detected Items:**\n`;
      for (const item of rich.detectedItems) {
        content += `- ${item.richResultType}\n`;
        if (item.items) {
          for (const subItem of item.items) {
            if (subItem.issues && subItem.issues.length > 0) {
              for (const issue of subItem.issues) {
                content += `  - ${issue.severity}: ${issue.issueMessage}\n`;
              }
            }
          }
        }
      }
    }
    content += `\n`;
  }

  // Inspection Link
  if (inspection.inspectionResultLink) {
    content += `\n[View in Search Console](${inspection.inspectionResultLink})\n`;
  }

  return {
    content,
    format: 'markdown',
  };
}

export function formatUrlInspectionJson(result: UrlInspectionResult): FormattedResult {
  return {
    content: JSON.stringify(result, null, 2),
    format: 'json',
  };
}

// ============================================================================
// Sitemaps Formatters
// ============================================================================

export function formatSitemapsMarkdown(response: SitemapsListResponse): FormattedResult {
  const sitemaps = response.sitemap || [];

  if (sitemaps.length === 0) {
    return {
      content: '## Sitemaps\n\nNo sitemaps found for this site.',
      format: 'markdown',
      metadata: { rowCount: 0 },
    };
  }

  let content = `## Sitemaps\n\n`;
  content += `| Path | Type | Submitted | Status |\n`;
  content += `|------|------|-----------|--------|\n`;

  for (const sitemap of sitemaps) {
    const status = sitemap.isPending ? '⏳ Pending' : sitemap.errors ? '❌ Errors' : '✅ OK';
    content += `| ${sitemap.path || '-'} | ${sitemap.type || '-'} | ${formatDate(sitemap.lastSubmitted)} | ${status} |\n`;
  }

  return {
    content,
    format: 'markdown',
    metadata: { rowCount: sitemaps.length },
  };
}

export function formatSitemapsJson(response: SitemapsListResponse): FormattedResult {
  return {
    content: JSON.stringify(response, null, 2),
    format: 'json',
    metadata: { rowCount: response.sitemap?.length || 0 },
  };
}

// ============================================================================
// Sites Formatters
// ============================================================================

export function formatSitesMarkdown(response: SitesListResponse): FormattedResult {
  const sites = response.siteEntry || [];

  if (sites.length === 0) {
    return {
      content: '## Verified Sites\n\nNo sites found.',
      format: 'markdown',
      metadata: { rowCount: 0 },
    };
  }

  let content = `## Verified Sites\n\n`;
  content += `| Site URL | Permission Level |\n`;
  content += `|----------|------------------|\n`;

  for (const site of sites) {
    content += `| ${site.siteUrl || '-'} | ${site.permissionLevel || '-'} |\n`;
  }

  return {
    content,
    format: 'markdown',
    metadata: { rowCount: sites.length },
  };
}

export function formatSitesJson(response: SitesListResponse): FormattedResult {
  return {
    content: JSON.stringify(response, null, 2),
    format: 'json',
    metadata: { rowCount: response.siteEntry?.length || 0 },
  };
}
