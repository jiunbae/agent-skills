---
name: capturing-appstore-screenshots
description: Methodology for capturing REAL-app (not mockup) App Store screenshots for iOS, iPadOS, and macOS, and uploading them via the App Store Connect API. Covers required dimensions per platform, deterministic capture techniques (simulator, device, offscreen/screenshot-mode render), localization, marketing-frame composition, and the reserve→upload→commit API flow. Use for "App Store 스크린샷", "앱스토어 스크린샷", "스크린샷 캡처", "스토어 스크린샷 방법론", "screenshot capture", "store screenshots" requests.
allowed-tools: Read, Bash, Grep, Glob, Write, Edit
tags: [app-store, screenshots, ios, ipados, macos, fastlane, asc-api, release]
---

# App Store Screenshots — Capture & Upload Methodology

Produce reproducible, **real-app** screenshots (not mockups) for every platform and push them to App Store Connect via API. Real captures beat hand-drawn mockups: they never drift from the shipped UI and can be regenerated from source.

## 1. Required dimensions (verify against Apple before a release)

Apple changes accepted sizes periodically — confirm at
https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
Upload the largest required size per family; App Store Connect down-scales for smaller devices.

| Platform | Upload this (px, portrait) | Notes |
|----------|---------------------------|-------|
| iPhone | **1290×2796** (6.9") | Required. 6.5" `1242×2688`/`1284×2778` optional. Landscape = swapped. |
| iPad | **2064×2752** (13") | Required. 12.9" `2048×2732` also accepted. |
| macOS | **2560×1600** (or 1280×800 / 1440×900 / 2880×1800) | 16:10 only. |

Rules: 1–10 screenshots per platform **per locale**; at least 1 for the required device size; exact pixel match or the upload is rejected; RGB, no alpha issues, `.png`/`.jpg`.

## 2. Capture techniques

### iOS / iPadOS
- **Simulator (fast, scriptable):**
  ```bash
  xcrun simctl boot "iPhone 16 Pro Max"
  xcrun simctl launch booted <bundle-id>
  # set up deterministic state first (see §3), then:
  xcrun simctl io booted screenshot 01.png    # exact device px, no bezel
  # localized UI:
  xcrun simctl launch booted <id> -AppleLanguages "(ko)" -AppleLocale ko_KR
  ```
- **UI test (most reliable state control):** an `XCTestCase` drives the app and calls
  `XCUIScreen.main.screenshot()`; pair with **fastlane snapshot** to loop devices×locales.
- **Physical device:** Xcode → Devices, or side buttons; last resort (manual, non-reproducible).
- **DEBUG "shot-view" harness (launch-arg root view):** for a screen that needs a live store,
  network, or a specific navigation state you can't script, gate a dedicated root view behind a
  launch arg and render it deterministically. This captures the *real* SwiftUI view with fixed
  data — no mocked pixels.
  ```swift
  // RootView.body:
  #if DEBUG
  if ProcessInfo.processInfo.arguments.contains("-appIAPShot") { return AnyView(IAPShotView()) }
  if ProcessInfo.processInfo.arguments.contains("-appWidgetShot") { return AnyView(WidgetShotView()) }
  #endif
  ```
  Launch with `xcrun simctl launch booted <id> -appWidgetShot`. Use for IAP/paywall screens
  (StoreKit isn't live in the simulator) and for widget previews.

### iOS widgets / Lock Screen widgets (composite onto a real Home Screen)
You cannot script-add a widget to the Simulator Home Screen without `idb` (tap automation), and
widget **entry views live in the extension target**, not the app target. Two-step real capture:
1. **Render the real widget view in a DEBUG app-target harness.** Reproduce the widget's row
   layout using the **shared** helpers both targets compile (e.g. `InitialCircle`, `formatOtpCode`
   in a `Shared/` folder) so the captured pixels equal the shipped widget. Frame it at the widget's
   point size with the system-background rounded rect, on a solid **black** field, and capture in
   the simulator (`-appWidgetShot`).
2. **Composite onto a real Springboard.** Capture the actual Home Screen
   (`xcrun simctl launch booted com.apple.springboard` → `simctl io booted screenshot`), auto-crop
   the widget from the black field (bbox of non-black; restrict the scan band so the status-bar
   battery/home-indicator don't inflate the bbox), re-apply a rounded-corner alpha mask, drop a soft
   shadow, and paste it into the empty grid area. Result looks like a genuine placed widget.

### macOS
- **Offscreen / "screenshot mode" render (best — headless, deterministic):** ship a hidden mode
  in the app that reads env vars, forces a fixed window/content state, renders the view to a
  bitmap, and writes a PNG. No window server framing, exact pixels. This is what a menu-bar app
  (no normal window) needs. Example wiring:
  ```bash
  APP_SCREENSHOT_MODE=1 APP_SCREENSHOT_SCENE=icon-grid \
  APP_SCREENSHOT_OUTPUT=01.png \
  ./.build/release/MyApp -AppleLanguages "(ko)" -AppleLocale ko_KR
  ```
  In code: read the env, build the view with a fixed `Descriptor` (folders, selection, view mode,
  scale, sort), render `NSView`→`NSBitmapImageRep`→PNG at the target size, then `exit(0)`.
- **Live window capture:** `screencapture -o -x -R x,y,w,h out.png` — simpler but needs a real
  window at known coordinates and a logged-in GUI session.

> ⚠️ **From a sandboxed / background / SSH agent context you usually CANNOT capture the macOS GUI
> at all — no matter the tool.** There is no macOS simulator, so the app must render into a real
> logged-in WindowServer session; an agent process typically runs in a different security domain
> that can't see it. Diagnose before wasting time building a UI-test target:
> ```bash
> screencapture -x /tmp/t.png            # "could not create image from display" ⇒ blocked
> swift -e 'import CoreGraphics; var n:UInt32=0; CGGetActiveDisplayList(0,nil,&n); print("displays",n)'
> # activeDisplays == 0 ⇒ no capturable display in this context
> swift -e 'import CoreGraphics; let w=CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as! [[String:Any]]; print("normalWindows", w.filter{($0[kCGWindowLayer as String] as? Int)==0}.count)'
> # normal (layer-0) windows == 0 ⇒ you cannot see the user's GUI windows; XCUIScreenshot & ScreenCaptureKit fail too
> ```
> `NSScreen.main` may still return a *cached* frame — it is **not** proof of capture access; trust
> `CGGetActiveDisplayList`/`CGWindowList`. If all three show blocked, the only options are:
> (a) the **offscreen render-to-bitmap** path above (headless-safe, agent-doable), or
> (b) **hand off to a human in a real GUI session** (`⌘⇧4` → `Space` → click the window/popover).
> A menu-bar popover in particular is a separate transient window a human must open before capturing.

> ⚠️ **Data-safety:** the macOS app uses your **real App Group container** (the live vault), unlike
> the simulator which is isolated. **Never run a demo-seed debug hook (`-appDemo`) against the real
> macOS build** — it can overwrite real user data (this has caused data loss). Seed demo state only
> in the simulator, or gate demo seeding to an isolated/temp store that provably never touches the
> real container.

## 3. Make it deterministic (critical)

Non-reproducible screenshots rot. Pin everything:
- **Fixture data** in a known dir with **fixed filenames and timestamps** so "2 days ago"/sort
  order never changes: `touch -t 202605041804 fixture.png`.
- Fixed **window size, selection, scroll, view mode, sort, locale**.
- Generate fixture assets from a script (checked into the repo), not by hand.
- Drive one scene per invocation via an env var / launch argument so a `for` loop emits the whole set.

## 4. Real vs. marketing-frame

Both are allowed. Keep the **real capture** as the source of truth; if you want captions/device
frames, **compose them on top of the real capture** (never redraw the UI). Store the pipeline in-repo:
```
capture_real_screenshots.sh   →  screenshots-live/…       (pure real UI, canonical)
generate_marketing_assets     →  reads screenshots-live/, adds copy/frame → screenshots/
```
Then the website and the store pull from the same generated real UI. One source, no drift.

## 5. Upload via App Store Connect API

No public "screenshot upload" one-shot — it is a 3-step reservation flow per image. Auth = ES256 JWT
from your `.p8` key (`openssl dgst -sha256 -sign AuthKey.p8`, DER→raw sig).

```
# find the set for a locale
GET /v1/appStoreVersionLocalizations/{locId}/appScreenshotSets   # → APP_DESKTOP / APP_IPHONE_69 …

# (replace) delete old shots
DELETE /v1/appScreenshots/{id}

# per new screenshot:
1. POST /v1/appScreenshots
   { data:{ type, attributes:{fileName,fileSize},
            relationships:{ appScreenshotSet:{data:{type,id}} } } }
   → returns uploadOperations[] and the appScreenshot id
2. for op in uploadOperations:        # usually one
     <op.method> op.url  with op.requestHeaders  body = fileBytes[op.offset : op.offset+op.length]
3. PATCH /v1/appScreenshots/{id}
   { data:{ attributes:{ uploaded:true, sourceFileChecksum:<md5-hex> } } }

# ordering
PATCH /v1/appScreenshotSets/{setId}/relationships/appScreenshots
   { data:[ {type:appScreenshots,id}, … ] }   # explicit display order
```
Poll `assetDeliveryState.state` until `COMPLETE` before submitting.

## 5b. In-App Purchase review screenshots (separate asset)

Each IAP needs its **own** review screenshot (one, any size ≥ 640×920) — distinct from app
screenshots. Same 3-step flow, different resource: `inAppPurchaseAppStoreReviewScreenshots`
(reserve `POST` with `relationships.inAppPurchaseV2` → `PUT` bytes to `uploadOperations` →
`PATCH {uploaded:true, sourceFileChecksum:<md5>}`). For a purely functional tip/consumable, a
DEBUG shot-view (§2) of the support screen is enough.

**IAP submission pitfalls (they block the whole version):**
- **Stuck in `MISSING_METADATA` even with name + price + localization + review screenshot?** The
  missing piece is almost always **Availability (territories)**. Set it:
  `POST /v1/inAppPurchaseAvailabilities { attributes:{availableInNewTerritories:true},
  relationships:{ inAppPurchase, availableTerritories:{data:[{type:territories,id:"USA"},…]} } }`
  (fetch all ~175 ids from `GET /v1/territories?limit=200`). It flips to `READY_TO_SUBMIT`.
- **A first-ever consumable MUST be submitted *on* an app version — and the API cannot attach it.**
  `reviewSubmissionItems` has **no** IAP relationship; `POST /v1/inAppPurchaseSubmissions` rejects a
  first consumable (`FIRST_CONSUMABLE_MUST_BE_SUBMITTED_ON_VERSION`); legacy
  `appStoreVersionSubmissions` no longer allows `CREATE`. **Only the ASC web UI** can bind them:
  version page → *In-App Purchases and Subscriptions* → add the IAPs → *Add for Review*. The API can
  then do the **final** `PATCH /v1/reviewSubmissions/{id} {submitted:true}` once a human has staged it.

## 6. Gotchas (learned the hard way)

- **Screenshots lock during review.** Editing while the version is `WAITING_FOR_REVIEW` returns
  `409 STATE_ERROR` ("Can't Delete Screenshot After Submit for review"). To change them: cancel the
  review submission (`PATCH /v1/reviewSubmissions/{id} {canceled:true}`) → version drops to
  `DEVELOPER_REJECTED` (editable) → swap → **resubmit** (`POST reviewSubmissions` +
  `reviewSubmissionItems` + `PATCH {submitted:true}`). This resets the review queue position.
- **`READY_FOR_REVIEW` ≠ `WAITING_FOR_REVIEW`.** The UI's *Add for Review* only **stages** the
  submission (`READY_FOR_REVIEW`, still editable — a good window to swap screenshots); it is **not**
  in Apple's queue until the final *Submit to App Review* (or API `PATCH {submitted:true}`) flips it
  to `WAITING_FOR_REVIEW`. Don't assume "added" means "submitted" — verify `appStoreState`.
- **Dimensions are exact.** 2559×1600 is rejected. Render at the precise target size.
- **iPhone slot accepts two sizes.** `APP_IPHONE_67` takes both `1290×2796` (6.7") and
  `1320×2868` (6.9" Max) — a screenshot captured on either device fits the same set.
- **macOS app icon is NOT a screenshot.** It is extracted from the build's embedded `.icns`
  (`CFBundleIconFile`), so a new icon needs a rebuild+reupload, not a screenshot swap.
- **CDN caching:** ASC/mzstatic caches thumbnails; after a swap the UI may show the old image for
  minutes–hours. Hard-refresh or verify the underlying asset via the API instead of the web UI.
- **Localize per locale:** screenshots are per `appStoreVersionLocalization`; a ko-only listing
  shows ko screenshots to everyone, but add locale-specific sets for each localization you ship.
- **Renamed repo / moved Pages** breaks any URL-bearing screenshot text or metadata — re-verify
  live URLs (privacy/marketing) after any rename before submitting.

## Quick checklist

- [ ] Correct exact px per platform, verified against Apple's current spec page
- [ ] Deterministic fixtures (fixed names + timestamps), fixed state, right locale
- [ ] Real capture is the source; marketing frames composed on top
- [ ] Uploaded via reserve→PUT→commit, order set, all `COMPLETE`
- [ ] Version editable (not mid-review) before swapping; resubmit after
- [ ] macOS: confirmed a capture path exists (offscreen render, or human GUI session) — an agent
      context can't screenshot the GUI (`activeDisplays==0`); never demo-seed the real container
- [ ] Each IAP has a review screenshot **and** Availability set (else `MISSING_METADATA`); first
      consumables bound to the version in the web UI before the final `submitted:true`
