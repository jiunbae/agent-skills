---
name: automating-appstore-connect
description: Automates App Store Connect via JWT API/Playwright hybrid. Supports app info, builds, TestFlight deployment, screenshot upload, and app submission. Use for "ASC", "TestFlight", "앱스토어", iOS deployment tasks.
trigger-keywords: App Store Connect, ASC, TestFlight, 앱스토어, 앱 제출
allowed-tools: Bash, Read, Edit, Write, Skill
tags: [ios, app-store, testflight, deployment, apple]
---

# App Store Connect Automation

JWT API + Playwright hybrid for ASC tasks.

## Prerequisites

```bash
# API Key from App Store Connect
export ASC_KEY_ID="xxx"
export ASC_ISSUER_ID="xxx"
export ASC_PRIVATE_KEY_PATH="~/.appstore/AuthKey_xxx.p8"
```

## Quick Reference

### Generate JWT

```bash
# JWT valid for 20 minutes
jwt encode --alg ES256 \
  --kid $ASC_KEY_ID \
  --iss $ASC_ISSUER_ID \
  --exp "+20min" \
  --secret @$ASC_PRIVATE_KEY_PATH
```

### List Apps

```bash
curl -H "Authorization: Bearer $JWT" \
  "https://api.appstoreconnect.apple.com/v1/apps"
```

### Get Builds

```bash
curl -H "Authorization: Bearer $JWT" \
  "https://api.appstoreconnect.apple.com/v1/builds?filter[app]=$APP_ID"
```

### Submit for Review

```bash
curl -X POST -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"data":{"type":"appStoreVersionSubmissions","relationships":{"appStoreVersion":{"data":{"type":"appStoreVersions","id":"$VERSION_ID"}}}}}' \
  "https://api.appstoreconnect.apple.com/v1/appStoreVersionSubmissions"
```

## Common Workflows

### TestFlight Distribution

1. Upload build (via Xcode/fastlane)
2. Wait for processing
3. Add to test group
4. Notify testers

### App Submission

1. Create new version
2. Upload screenshots
3. Fill metadata
4. Submit for review

## Playwright Fallback

For UI-only features (screenshot ordering, promo text):
```typescript
await page.goto('https://appstoreconnect.apple.com')
await page.fill('#account_name_text_field', email)
// ... automation
```

## Rate Limits

- 3600 requests/hour per key
- Use pagination for large lists
