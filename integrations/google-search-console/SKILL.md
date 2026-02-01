---
name: integrating-search-console
description: Integrates with Google Search Console API. Supports search performance analysis, URL inspection, sitemap management, and site verification. Use for "GSC", "서치콘솔", "검색 성과", "SEO 분석" requests.
trigger-keywords: google search console, gsc, 서치콘솔, 검색 성과, seo 분석
allowed-tools: Read, Write, Edit, Bash
---

# Google Search Console Integration

Search performance analysis and SEO management.

## Prerequisites

```bash
export GSC_SERVICE_ACCOUNT="path/to/service-account.json"
export GSC_SITE_URL="https://example.com"
```

## Quick Reference

### Get Search Analytics

```bash
# Using gsc-cli or API
gsc query --site $GSC_SITE_URL \
  --start-date 2024-01-01 \
  --end-date 2024-01-31 \
  --dimensions query,page
```

### Inspect URL

```bash
gsc inspect --url "https://example.com/page"
# Returns: indexed status, crawl info, mobile usability
```

### Submit Sitemap

```bash
gsc sitemap submit --site $GSC_SITE_URL \
  --sitemap "https://example.com/sitemap.xml"
```

## Common Queries

### Top Queries
```sql
SELECT query, clicks, impressions, ctr, position
ORDER BY clicks DESC
LIMIT 100
```

### Pages with Issues
```sql
SELECT page, impressions
WHERE position > 10
ORDER BY impressions DESC
```

## Metrics

| Metric | Description |
|--------|-------------|
| Clicks | Search result clicks |
| Impressions | Times shown in results |
| CTR | Click-through rate |
| Position | Average ranking |

## Workflows

### Weekly Report
1. Fetch last 7 days data
2. Compare to previous week
3. Highlight changes >20%
4. List top queries/pages

### Index Coverage Check
1. Get indexing status
2. Identify errors/warnings
3. Prioritize high-traffic pages

## Best Practices

- Query daily for trend analysis
- Focus on high-impression, low-CTR pages
- Monitor Core Web Vitals via API
