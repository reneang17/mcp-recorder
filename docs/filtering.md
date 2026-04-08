# Filtering Architecture

## Overview

The MCP Recorder captures two streams of data from Chrome: **DOM events** (clicks, typing, form submissions) and **network requests** (API calls, page navigations). On a real website, the browser generates hundreds of requests that have nothing to do with what the user is doing — trackers, analytics, fonts, images, heartbeats, and more.

The filtering system's job is to separate **signal** (what the user intentionally did) from **noise** (what the browser did automatically), so that the recorded step log can be used to build reliable MCP automation tools.

## Two-Stage Architecture

Filtering happens at two stages, each with distinct responsibilities:

```
Chrome → CDP Events
         │
         ▼
┌─────────────────────────────┐
│  Stage 1: CAPTURE-TIME      │  Runs DURING recording
│  Filters on raw requests    │  Prevents noise from entering memory
│                             │
│  • Blocked protocols        │  cheap string checks
│  • Blocked resource types   │  CDP-level classification
│  • Blocked file extensions  │  URL path patterns
│  • Blocked tracker domains  │  known analytics domains
│  • OPTIONS preflight        │  CORS preflight requests
└─────────┬───────────────────┘
          │ Only clean requests survive
          ▼
┌─────────────────────────────┐
│  Correlation Engine         │  Pairs DOM events ↔ Network requests
│  (correlator.ts)            │  by timestamp within a 2-second window
└─────────┬───────────────────┘
          │ RecordedStep[] with pairing info
          ▼
┌─────────────────────────────┐
│  Stage 2: POST-RECORDING    │  Runs AFTER correlation
│  Filters on correlated data │  Uses pairing info for smart decisions
│                             │
│  • User-intent scoring      │  drops orphan background requests
│  • Same-origin filtering    │  drops cross-origin noise
└─────────┬───────────────────┘
          │ Clean steps for MCP tool building
          ▼
       Output JSON
```

## Stage 1: Capture-Time Filters

These filters run inside the `Network.requestWillBeSent` handler — they discard noise before it's ever stored in memory. Each filter is an independent, named function that returns a `CaptureFilterResult`:

```typescript
interface CaptureFilterResult {
  keep: boolean;           // true = keep, false = discard
  rejectedBy: string;      // name of the filter that rejected it
  reason: string;          // human-readable explanation
}
```

### Filter: `protocols`

**What it does:** Blocks URLs starting with non-HTTP protocols.

| Blocked Protocol | Why |
|-----------------|-----|
| `chrome-extension://` | Internal browser extension requests |
| `data:` | Inline data URIs (embedded images, scripts) |
| `blob:` | In-memory blob objects |
| `devtools:` | Chrome DevTools internal requests |

**Risk of false positives:** None. These protocols never represent user-intent API calls.

**Toggle:** `--no-filter-protocols`

---

### Filter: `resource-types`

**What it does:** Uses CDP's built-in resource type classification to block non-API resources.

| Blocked Type | Why |
|-------------|-----|
| `Image` | Logo, hero image, icon loads |
| `Font` | Web font downloads |
| `Stylesheet` | CSS file loads |
| `Media` | Audio/video streaming |
| `Manifest` | PWA manifest.json |
| `Ping` | Navigator.sendBeacon analytics |
| `Preflight` | Internal CDP classification for CORS |
| `CSPViolationReport` | Content Security Policy reports |
| `Other` | Miscellaneous (usually noise) |

**Allowed types** (by default): `XHR`, `Fetch`, `Document`

**Risk of false positives:** Very low. User-intent API calls are always XHR, Fetch, or Document type.

**Toggle:** `--no-filter-resource-types`

---

### Filter: `file-extensions`

**What it does:** Blocks URLs whose path ends with known static asset extensions.

Blocked extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.svg`, `.webp`, `.avif`, `.ico`, `.woff`, `.woff2`, `.ttf`, `.eot`, `.otf`, `.mp4`, `.webm`, `.mp3`, `.ogg`, `favicon.ico`

**Why needed:** Covers cases where CDP classifies a resource as `XHR` or `Fetch` but it's actually a static asset being loaded dynamically (e.g., lazy-loaded images via Fetch API).

**Risk of false positives:** Very low. API endpoints don't end in `.png` or `.woff2`.

**Toggle:** `--no-filter-extensions`

---

### Filter: `tracker-domains`

**What it does:** Blocks requests to known analytics and tracking domains.

Currently blocks 25+ domains including: `google-analytics.com`, `googletagmanager.com`, `facebook.com`, `connect.facebook.net`, `doubleclick.net`, `hotjar.com`, `sentry.io`, `segment.com`, `mixpanel.com`, `amplitude.com`, `fullstory.com`, `clarity.ms`, `hubspot.com`, and more.

**Limitation:** This is a blocklist — it can only catch domains we explicitly list. New trackers or first-party telemetry (e.g., `amazon.com/api/beacon`) will pass through. This is why Stage 2 post-filters exist.

**Risk of false positives:** Very low. These domains are exclusively analytics/tracking services.

**Toggle:** `--no-filter-trackers`

---

### Filter: `options-preflight` (Point 3)

**What it does:** Blocks all HTTP `OPTIONS` requests.

**Why:** When the browser makes a cross-origin API call, it automatically sends a CORS preflight `OPTIONS` request first. These are:
- Never triggered by the user
- Contain no request body or useful data
- Always paired 1:1 with the actual request that follows
- Automatically generated by the browser during replay

For an agent replaying a workflow, capturing `OPTIONS` is pure noise — the browser will generate them automatically when the real requests are replayed.

**Risk of false positives:** None. No user workflow requires explicitly replaying an OPTIONS request.

**Toggle:** `--no-filter-options`

---

## Stage 2: Post-Recording Filters

These filters run after the correlation engine has paired DOM events with network requests. They use the **pairing information** to make smarter filtering decisions.

### Filter: `user-intent` (Point 5)

**What it does:** Assigns a confidence score to each step, then optionally drops low-confidence steps.

| Score | Condition | Example | Action |
|-------|----------|---------|--------|
| **HIGH** | DOM event + network request paired | Click "Submit" → POST /api/order | Keep |
| **HIGH** | DOM event only (no network call) | Click a button, type into a field | Keep |
| **MEDIUM** | Orphan Document request | GET /checkout (page navigation) | Keep |
| **LOW** | Orphan XHR/Fetch request | GET /api/heartbeat (background) | **Drop** |

**Why this is the strongest filter:** It doesn't need to know domain names or URL patterns. It uses a fundamental truth: *if the user didn't interact with the page before a request fired, that request isn't part of the workflow.* This catches all noise we could never predict — proprietary trackers, custom analytics, internal telemetry.

**Why Document requests are MEDIUM, not LOW:** The user may navigate by typing a URL in the address bar, which doesn't generate a DOM event but does generate a Document request. These are legitimate user-intent actions.

**Risk of false positives:** Low. The only case is a cascade where clicking a button triggers a visible API call AND a background API call — the background call would be scored LOW. But in practice, the visible call (the one the agent needs to replay) is the correlated one.

**Enable:** `--user-intent`

---

### Filter: `same-origin` (Point 6)

**What it does:** Only keeps network requests that go to the **same origin** (protocol + hostname + port) as the page the user is on.

**Example on `https://example.com`:**
```
✅ KEEP: POST https://example.com/api/order     (same origin)
✅ KEEP: GET  https://example.com/checkout       (same origin)
❌ DROP: GET  https://analytics.google.com/collect (cross-origin)
❌ DROP: POST https://tracker.com/event          (cross-origin)
✅ KEEP: POST https://api.stripe.com/v1/charge   (if --allow-domain api.stripe.com)
```

**Important exceptions — these are ALWAYS kept regardless of origin:**
1. **DOM-only steps** — user actions with no network request
2. **Correlated steps** — user action paired with a network request (user intent)

This means if the user clicks "Pay" and it triggers a cross-origin Stripe API call, the correlated step (click → Stripe POST) is kept because it has user intent.

**When to use:** Best for simple same-domain workflows. Not suitable for multi-service flows (OAuth, payment gateways) without `--allow-domain` exceptions.

**Enable:** `--same-origin` (optionally with `--allow-domain <domain>`)

---

## Pipeline Execution Order

The filter pipeline runs in a specific order optimized for performance and correctness:

### Capture-time (cheapest first)
1. `options-preflight` — single string comparison
2. `protocols` — string prefix check
3. `resource-types` — array inclusion check
4. `file-extensions` — regex match on URL path
5. `tracker-domains` — URL parse + domain check

### Post-recording (broadest first)
1. `user-intent` — scores all steps, optionally drops LOW
2. `same-origin` — further narrows by origin matching

The pipeline **short-circuits**: as soon as one filter rejects a request, subsequent filters are skipped.

---

## Debugging Filters

### See every filter decision

```bash
npm run cli -- --port 9222 --debug
```

Output on stderr shows every request and which filter caught it:
```
[network] Request: GET https://www.google-analytics.com/collect
  [filter:options-preflight] PASS — Not an OPTIONS request
  [filter:protocols] PASS — No blocked protocol found
  [filter:resource-types] PASS — Resource type "XHR" is allowed
  [filter:file-extensions] PASS — No blocked file extension
  [filter:tracker-domains] REJECT — Hostname "www.google-analytics.com" matches blocked tracker domain
  → DISCARDED by "tracker-domains": Hostname matches blocked tracker domain
```

### Disable a specific filter to investigate

If you suspect a filter is eating legitimate requests:

```bash
# "Are tracker domain filters dropping something I need?"
npm run cli -- --port 9222 --no-filter-trackers --debug

# "Is resource-type filtering too aggressive?"
npm run cli -- --port 9222 --no-filter-resource-types --debug

# "Show me absolutely everything Chrome captures"
npm run cli -- --port 9222 --no-filters --debug
```

### Test filter behavior programmatically

```typescript
import { runCaptureFilters, DEFAULT_CAPTURE_FILTERS } from './filters';

const result = runCaptureFilters(
  'https://example.com/api/data',
  'GET',
  'XHR',
  ['XHR', 'Fetch', 'Document'],
  DEFAULT_CAPTURE_FILTERS,
  true  // debug mode
);

console.log(result);
// { keep: true, rejectedBy: null, reason: 'Passed all capture filters' }
```

---

## Recommended Configurations

### Basic recording (default)
All capture-time filters ON. Post-filters OFF. Good for exploration.
```bash
npm run cli -- --port 9222
```

### Clean recording for MCP tool building (recommended)
Adds user-intent filtering to drop background noise.
```bash
npm run cli -- --port 9222 --user-intent
```

### Strict mode for same-domain workflows
Maximum noise reduction. Only same-origin + user-intent steps survive.
```bash
npm run cli -- --port 9222 --user-intent --same-origin
```

### Strict mode with payment gateway exception
Same-origin but allow Stripe API calls through.
```bash
npm run cli -- --port 9222 --user-intent --same-origin --allow-domain api.stripe.com
```

### Raw capture (no filters) for debugging
See everything Chrome captures — useful for understanding what a site does.
```bash
npm run cli -- --port 9222 --no-filters
```
