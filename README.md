# MCP Recorder — CDP Recording Engine

A standalone Node.js/TypeScript library that connects to a live Chrome instance via the **Chrome DevTools Protocol (CDP)** and records a deterministic, step-by-step log of user interactions (DOM events) and network traffic (API calls). The recorded output is designed for downstream use in building MCP (Model Context Protocol) automation tools, where an AI agent learns browser workflows by observing real human sessions.

## Table of Contents

- [Purpose and Context](#purpose-and-context)
- [Architecture](#architecture)
- [Data Flow Pipeline](#data-flow-pipeline)
- [Project Structure](#project-structure)
- [Source Files In Detail](#source-files-in-detail)
- [Core Data Types](#core-data-types)
- [Filtering System](#filtering-system)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Programmatic API](#programmatic-api)
- [Testing](#testing)
- [Design Decisions](#design-decisions)
- [Known Limitations](#known-limitations)
- [Future Work](#future-work)

---

## Purpose and Context

This project is **Stage 1** of a larger pipeline:

```
Stage 1 (this project)        Stage 2 (future)              Stage 3 (future)
┌─────────────────────┐       ┌──────────────────────┐      ┌───────────────────┐
│  CDP Recording      │──────>│  Argument Tagging    │─────>│  MCP Tool         │
│  Engine             │       │  (LLM/heuristic)     │      │  Generation       │
│                     │       │                      │      │                   │
│  Records DOM events │       │  Maps input fields   │      │  Generates MCP    │
│  + Network requests │       │  to POST body keys   │      │  server tools     │
│  → RecordedStep[]   │       │  → TaggedStep[]      │      │  from tagged data │
└─────────────────────┘       └──────────────────────┘      └───────────────────┘
```

**Stage 1** answers: "What exactly did the user do, and what network requests resulted?" It produces a `RecordedStep[]` array where each step pairs a DOM event (click, type, submit) with the network request it triggered (POST with form data), creating an end-to-end trace of user workflows.

---

## Architecture

The engine is built around **two parallel capture streams** that are correlated after recording stops:

```
Live Chrome Browser
       │
       │ CDP WebSocket
       │
   ┌───┴───────────────────────────────────────────────┐
   │                  Recorder                          │
   │                                                    │
   │  ┌──────────────┐         ┌───────────────────┐   │
   │  │  DomCapture   │         │  NetworkCapture    │   │
   │  │              │         │                   │   │
   │  │  Injects JS  │         │  Listens to CDP   │   │
   │  │  into page   │         │  Network domain   │   │
   │  │              │         │                   │   │
   │  │  Pushes DOM  │         │  Pairs req/res    │   │
   │  │  events via  │         │  by requestId     │   │
   │  │  binding     │         │                   │   │
   │  │              │         │  Applies capture   │   │
   │  │  DomEvent[]  │         │  filters (noise)  │   │
   │  └──────┬───────┘         │                   │   │
   │         │                 │  NetworkRequest[] │   │
   │         │                 └────────┬──────────┘   │
   │         │                          │              │
   │         └────────┬─────────────────┘              │
   │                  │                                │
   │         ┌────────▼─────────┐                      │
   │         │   Correlator      │                      │
   │         │                  │                      │
   │         │  Pairs DOM event │                      │
   │         │  with nearest    │                      │
   │         │  network request │                      │
   │         │  within 2s window│                      │
   │         └────────┬─────────┘                      │
   │                  │                                │
   │         ┌────────▼─────────┐                      │
   │         │  Post-Filters     │                      │
   │         │                  │                      │
   │         │  User-intent     │                      │
   │         │  Same-origin     │                      │
   │         └────────┬─────────┘                      │
   │                  │                                │
   │                  ▼                                │
   │           RecordedStep[]                          │
   └───────────────────────────────────────────────────┘
```

---

## Data Flow Pipeline

Here's the exact sequence of operations when a recording session runs:

1. **Connect** — `cdp-client.ts` opens a WebSocket to Chrome's debug port, selects the first `page` target.

2. **Start recording** — Two subsystems activate in parallel:
   - `NetworkCapture.start()` enables CDP's `Network` domain and registers three listeners: `requestWillBeSent`, `responseReceived`, `loadingFailed`. Every incoming request runs through the **capture filter pipeline** (`filters.ts`) before being stored.
   - `DomCapture.start()` registers a `Runtime.addBinding()` callback and injects a JavaScript snippet into the page. The snippet attaches `click`, `input`, `change`, `submit`, and `keydown` (Enter) listeners. Events are pushed from the page to Node.js instantly via the binding, not polled.

3. **Page navigations** — When `Page.loadEventFired` fires, the DOM capture script is re-injected (it's destroyed on navigation). The binding endpoint survives.

4. **Stop recording** — Both subsystems flush pending data:
   - `NetworkCapture.stop()` moves any pending (unflushed) requests to the captured list and disables the Network domain.
   - `DomCapture.stop()` drains any events buffered in-page and stops the fallback poller.

5. **Correlate** — `correlator.ts` pairs DOM events with network requests by timestamp proximity:
   - Sort both arrays by timestamp.
   - For each network request, find the nearest **preceding** DOM event within the correlation window (default 2 seconds).
   - Each DOM event is used at most once. Orphans (unpaired events/requests) become standalone steps.

6. **Post-filter** — `post-filters.ts` optionally applies:
   - **User-intent scoring** — assigns `high`/`medium`/`low` confidence. `low` steps (orphan XHR/Fetch) are dropped if `--user-intent` is enabled.
   - **Same-origin filtering** — drops orphan cross-origin network requests if `--same-origin` is enabled.

7. **Output** — The final `RecordedStep[]` is serialized to JSON and written to stdout.

---

## Project Structure

```
mcp-recorder/
├── src/                         # Source code
│   ├── types.ts                 # All TypeScript interfaces and defaults
│   ├── cdp-client.ts            # CDP WebSocket connection wrapper
│   ├── recorder.ts              # Main orchestrator (public API)
│   ├── dom-capture.ts           # DOM event injection + real-time push
│   ├── network-capture.ts       # Network req/res pairing + filtering
│   ├── correlator.ts            # DOM ↔ Network timestamp correlation
│   ├── filters.ts               # Capture-time filter pipeline
│   ├── post-filters.ts          # Post-recording filter pipeline
│   └── cli.ts                   # CLI entry point
├── tests/                       # Test suite (vitest)
│   ├── correlator.test.ts       # 14 tests — correlation algorithm
│   ├── filters.test.ts          # 49 tests — capture-time filters
│   ├── post-filters.test.ts     # 21 tests — post-recording filters
│   ├── dom-capture.test.ts      # 4 tests  — real-browser DOM capture
│   ├── network-capture.test.ts  # 3 tests  — real-browser network capture
│   ├── integration.test.ts      # 2 tests  — full end-to-end flow
│   └── helpers/
│       └── chrome-launcher.ts   # Launches headless Chrome for tests
├── test-fixtures/
│   └── test-form.html           # HTML form served during integration tests
├── docs/
│   └── filtering.md             # Exhaustive filtering documentation
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Source Files In Detail

### `src/types.ts` — Type System

All TypeScript interfaces live here. This is the **single source of truth** for the shape of all data flowing through the system.

| Type | Purpose |
|------|---------|
| `DomEvent` | A single user interaction captured from the page (click, input, change, submit, keydown). Contains `selector`, `tagName`, `inputValue`, `timestamp`, and `url`. |
| `NetworkRequest` | A single HTTP request captured from CDP's Network domain. Contains `method`, `url`, `requestHeaders`, `postData`, `parsedBody`, `responseStatus`, and `resourceType`. |
| `RecordedStep` | The output unit — one step in the recorded session. Contains a nullable `domEvent`, a nullable `networkRequest`, a human-readable `description`, and an optional `intentScore`. |
| `CaptureFilterConfig` | Five boolean toggles controlling capture-time filters. |
| `PostFilterConfig` | Two boolean toggles controlling post-recording filters. |
| `FilterConfig` | Combines `CaptureFilterConfig`, `PostFilterConfig`, `allowedDomains`, and `debug`. |
| `RecorderOptions` | Full configuration for the `Recorder` class (port, correlation window, filters). |
| `RecorderInput` | Constructor input type — accepts deeply partial filter configs for ergonomic usage. |

Default values are exported as `DEFAULT_OPTIONS`, `DEFAULT_CAPTURE_FILTERS`, `DEFAULT_POST_FILTERS`, and `DEFAULT_FILTER_CONFIG`.

---

### `src/cdp-client.ts` — CDP Connection

Thin wrapper around the `chrome-remote-interface` npm package.

- **`connectCDP(port, tabUrl?)`** — Lists available targets via `GET /json`, picks the first `page` target (or one matching `tabUrl`), opens a WebSocket connection, and returns a `CDPConnection` object exposing `Network`, `Runtime`, `Page`, `Input`, and `DOM` protocol domains.
- **`disconnectCDP(client)`** — Closes the WebSocket. Swallows errors (Chrome may already be gone).

The `CDPConnection` interface is used as a dependency injection point — every other module receives it rather than managing its own connection.

---

### `src/dom-capture.ts` — DOM Event Capture

Captures user interactions by injecting a JavaScript snippet into the target page.

**Key design: `Runtime.addBinding` for real-time push.** Instead of polling `window.__mcp_dom_events` on a timer (which loses events when the page navigates/reloads), we use `Runtime.addBinding()` to register a function that the page can call to push events to Node.js instantly. This is critical for form submissions that trigger navigation — the events must be sent before the page unloads.

**Injected script behavior:**
- Attaches listeners on `click`, `input`, `change`, `submit`, `keydown` (Enter only) using `document.addEventListener(..., true)` (capture phase).
- Generates a CSS selector for each event target, using a priority order: `data-testid` > `id` > `aria-label` > `name` attribute > tag path.
- Truncates `innerText` to 100 chars to avoid bloating the output.
- Buffers events in `window.__mcp_dom_buffer` if the binding isn't yet available, then flushes them.
- Sets a `window.__mcp_dom_events_installed` guard to prevent double-installation.

**Fallback:** A polling loop runs every 500ms to drain any buffered events, covering edge cases where the binding doesn't work (e.g., certain Chrome internal pages).

**Re-injection:** On page navigation, the `Page.loadEventFired` event triggers `reinject()`, which re-evaluates the script on the new page. The binding endpoint in Node.js survives navigation.

---

### `src/network-capture.ts` — Network Request Capture

Captures HTTP requests using CDP's Network domain.

**Pairing mechanism:** Two events arrive separately — `requestWillBeSent` (provides URL, method, headers, body) and `responseReceived` (provides status code). We pair them by `requestId` using a temporary `Map<requestId, NetworkRequest>`. When the response arrives, the request is moved to the final `capturedRequests` array.

**Timestamp source:** Uses `wallTime` (Unix epoch seconds) from `requestWillBeSent`, converted to milliseconds. This matches `Date.now()` used by DOM events, enabling accurate timestamp-based correlation. *(Note: CDP's `timestamp` field uses a monotonic clock that's on a different scale than Date.now() and cannot be compared with DOM event timestamps.)*

**POST body parsing:** Automatically parses `postData` into a structured object:
- `application/json` → `JSON.parse()`
- `application/x-www-form-urlencoded` → `URLSearchParams` → key/value object
- Other types → stored as raw string in `postData`

**Filter pipeline:** Every incoming request passes through `runCaptureFilters()` before being stored. If any filter rejects it, the request is discarded and never enters memory.

**Failed requests:** `loadingFailed` events are handled — the request is still captured with `responseStatus: 0`.

---

### `src/correlator.ts` — Correlation Engine

Pairs DOM events with network requests by timestamp proximity to produce `RecordedStep[]`.

**Algorithm:**
1. Sort both `DomEvent[]` and `NetworkRequest[]` by timestamp.
2. For each network request, scan all unused DOM events to find the **nearest preceding** one within the correlation window (default 2000ms).
3. "Nearest preceding" means: `0 <= (netRequest.timestamp - domEvent.timestamp) <= windowMs`.
4. Each DOM event is consumed at most once (first network request wins).
5. Orphan network requests (no paired DOM event) become standalone steps.
6. Orphan DOM events (no paired network request) become standalone steps.
7. All steps are sorted by timestamp and assigned sequential indices.

**Description generation:** Each step gets a human-readable description:
- `Clicked button "Submit order" (body > form > p > button)`
- `Typed "Pizza" into input (input[name="custname"])`
- `Submitted form (html > body > form) → POST /post → 200`

Correlated steps combine both descriptions with `→`.

---

### `src/filters.ts` — Capture-Time Filters

Five named, independently toggleable filters that run during recording to discard noise before it enters memory.

Each filter function returns a `CaptureFilterResult`:

```typescript
interface CaptureFilterResult {
  keep: boolean;          // true = pass, false = discard
  rejectedBy: string;     // filter name (e.g., "tracker-domains")
  reason: string;         // human-readable explanation
}
```

| Filter Name | Function | What It Catches |
|-------------|----------|----------------|
| `options-preflight` | `filterOptionsPreflight()` | CORS preflight `OPTIONS` requests |
| `protocols` | `filterProtocols()` | `chrome-extension:`, `data:`, `blob:`, `devtools:` URLs |
| `resource-types` | `filterResourceTypes()` | Image, Font, Stylesheet, Media, Manifest, Ping, Other |
| `file-extensions` | `filterFileExtensions()` | `.png`, `.jpg`, `.woff2`, `.ttf`, `.svg`, `.ico`, etc. |
| `tracker-domains` | `filterTrackerDomains()` | 25+ known analytics domains (GA, Facebook, Hotjar, etc.) |

**Pipeline execution:** `runCaptureFilters()` runs all enabled filters in order (cheapest first for performance). Short-circuits on the first rejection.

**Debug mode:** When `debug: true`, every filter decision is logged to stderr with the filter name and reason.

**Legacy API:** `shouldCapture()`, `isNoiseUrl()`, and `isNoiseResourceType()` are preserved for backward compatibility with existing code.

---

### `src/post-filters.ts` — Post-Recording Filters

Two filters that run after correlation, using the DOM↔Network pairing information to make smarter decisions.

**User-intent scoring (`applyUserIntentFilter`):**
- `HIGH` — Step has a DOM event (with or without a network request). The user did something.
- `MEDIUM` — Orphan `Document` request. Likely a user-initiated page navigation.
- `LOW` — Orphan `XHR`/`Fetch` request. Background noise (heartbeats, trackers, auto-fetches).

When enabled (`--user-intent`), drops `LOW` steps. Always annotates all steps with `intentScore` even when disabled, for downstream inspection.

**Same-origin filtering (`applySameOriginFilter`):**
- Tracks the "current page origin" from DOM event URLs.
- Keeps same-origin orphan network requests, drops cross-origin orphans.
- **Always keeps** correlated steps (DOM + Network) regardless of origin.
- **Always keeps** DOM-only steps.
- Supports `--allow-domain` exceptions for known cross-origin APIs (e.g., Stripe).

**Pipeline:** `runPostFilters()` runs user-intent first (broadest filter), then same-origin (further narrows).

---

### `src/cli.ts` — CLI Entry Point

Parses command-line arguments, creates a `Recorder`, starts recording, and outputs JSON when the user presses Ctrl+C.

Output goes to **stdout** (JSON). Status messages go to **stderr** (logs). This allows piping: `mcp-recorder --port 9222 > recording.json`.

---

## Core Data Types

### DomEvent

```typescript
{
  id: "dom_1775598952812_0",          // unique ID: "dom_" + Date.now() + "_" + counter
  eventType: "click",                  // click | input | change | submit | keydown
  timestamp: 1775598952812,            // Date.now() in ms (Unix epoch)
  selector: "input[name=\"custname\"]", // CSS selector (data-testid > id > aria-label > name > path)
  tagName: "input",                    // lowercase HTML tag
  innerText: "",                       // truncated to 100 chars
  inputValue: "Pizza",                 // current value for form elements, null otherwise
  ariaLabel: null,                     // aria-label attribute if present
  url: "https://httpbin.org/forms/post" // page URL at event time
}
```

### NetworkRequest

```typescript
{
  requestId: "5935DF83BC4E1C8E06A8A2411578A4F9",  // CDP-assigned ID
  timestamp: 1775600682537.331,                     // wallTime * 1000 (Unix epoch ms)
  method: "POST",
  url: "https://httpbin.org/post",
  requestHeaders: { "Content-Type": "application/x-www-form-urlencoded", ... },
  postData: "custname=Pizza&custtel=&custemail=",   // raw POST body string
  parsedBody: { "custname": "Pizza", "custtel": "", ... },  // parsed into key-value
  bodyEncoding: "form-urlencoded",                  // json | form-urlencoded | multipart | text | none
  responseStatus: 200,                              // HTTP status or 0 for failures
  resourceType: "Document"                          // CDP resource type
}
```

### RecordedStep

```typescript
{
  id: "step_f3163e80-4b4d-47bd-a33c-4181d3f49ac4",  // crypto.randomUUID()
  index: 10,                        // sequential position in the recording
  domEvent: { ... } | null,         // paired DOM event (if any)
  networkRequest: { ... } | null,   // paired network request (if any)
  description: "Submitted form (html > body > form) → POST /post → 200",
  intentScore: "high"               // set by post-filters (high | medium | low)
}
```

---

## Filtering System

The filtering system operates in two stages, each independently toggleable for debugging. See [`docs/filtering.md`](docs/filtering.md) for the exhaustive deep-dive.

### Stage 1: Capture-time (during recording)

| Filter | CLI Toggle (disable) | Default |
|--------|---------------------|---------|
| Block protocols (`chrome-extension:`, `data:`, `blob:`) | `--no-filter-protocols` | ON |
| Block tracker domains (25+ analytics services) | `--no-filter-trackers` | ON |
| Block resource types (Image, Font, Stylesheet, etc.) | `--no-filter-resource-types` | ON |
| Block file extensions (`.png`, `.woff2`, `.ico`, etc.) | `--no-filter-extensions` | ON |
| Block OPTIONS preflight requests | `--no-filter-options` | ON |
| Disable ALL capture filters | `--no-filters` | — |

### Stage 2: Post-recording (after correlation)

| Filter | CLI Toggle (enable) | Default |
|--------|---------------------|---------|
| User-intent scoring — drop orphan XHR/Fetch | `--user-intent` | OFF |
| Same-origin — drop cross-origin orphans | `--same-origin` | OFF |

### Debug mode

```bash
# See every filter decision logged to stderr
npm run cli -- --port 9222 --debug
```

---

## Quick Start

### Prerequisites

- **Node.js** ≥ 18
- **Google Chrome** or Chromium installed locally

### Install

```bash
cd mcp-recorder
npm install
```

### Run manually

**Terminal 1 — Launch Chrome with debugging port:**

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/mcp-test
```

**Terminal 2 — Start recording:**

```bash
npm run cli -- --port 9222
```

Interact with Chrome (navigate, fill forms, click buttons), then press **Ctrl+C**. The JSON step log prints to stdout.

### Recommended for MCP tool building

```bash
npm run cli -- --port 9222 --user-intent
```

This keeps only steps with user intent (drops background noise).

---

## CLI Reference

```
Usage: mcp-recorder [options]

Options:
  --port, -p          CDP port (default: 9222)
  --duration, -d      Recording duration in seconds (default: until Ctrl+C)
  --debug             Log every filter decision to stderr

Post-recording filters:
  --user-intent       Only keep steps correlated with user actions
  --same-origin       Only keep same-origin network requests
  --allow-domain X    Allow domain X in same-origin mode (repeatable)

Disable individual capture filters (for debugging):
  --no-filter-protocols       Allow chrome-extension://, data:, blob: URLs
  --no-filter-trackers        Allow known tracker domains
  --no-filter-resource-types  Allow Image, Font, Stylesheet, etc.
  --no-filter-extensions      Allow .png, .woff2, .ico, etc.
  --no-filter-options         Allow OPTIONS preflight requests
  --no-filters                Disable ALL filters (capture raw everything)
```

### Examples

```bash
# Basic recording
npm run cli -- --port 9222

# Clean recording for MCP tool building (recommended)
npm run cli -- --port 9222 --user-intent

# Maximum noise reduction (same-domain workflows)
npm run cli -- --port 9222 --user-intent --same-origin

# Same-origin with Stripe exception
npm run cli -- --port 9222 --user-intent --same-origin --allow-domain api.stripe.com

# Debug: see every filter decision
npm run cli -- --port 9222 --debug

# Debug: disable trackers filter to check if it's eating real requests
npm run cli -- --port 9222 --no-filter-trackers --debug

# Raw capture (see absolutely everything)
npm run cli -- --port 9222 --no-filters

# Save to file
npm run cli -- --port 9222 --user-intent > recording.json

# Auto-stop after 30 seconds
npm run cli -- --port 9222 --duration 30
```

---

## Programmatic API

```typescript
import { Recorder } from './recorder';

// Create with defaults
const recorder = new Recorder({ port: 9222 });

// Or with specific filter config
const recorder = new Recorder({
  port: 9222,
  correlationWindowMs: 3000,
  filters: {
    captureFilters: {
      optionsPreflight: true,    // toggle individual filters
      trackerDomains: false,     // disable for debugging
    },
    postFilters: {
      userIntentOnly: true,      // drop background noise
      sameOriginOnly: true,      // only same-origin requests
    },
    allowedDomains: ['api.stripe.com'],
    debug: true,                 // log filter decisions
  },
});

// Record a session
await recorder.connect();
await recorder.startRecording();

// ... user interacts with Chrome ...

const steps = await recorder.stopRecording();
await recorder.disconnect();

// steps is RecordedStep[]
console.log(JSON.stringify(steps, null, 2));
```

### Public Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `constructor(options?)` | `Recorder` | Create with partial options (deep-merged with defaults) |
| `connect(tabUrl?)` | `Promise<void>` | Open CDP connection to Chrome |
| `startRecording(tabUrl?)` | `Promise<void>` | Begin capturing DOM events + network requests |
| `stopRecording()` | `Promise<RecordedStep[]>` | Stop, correlate, filter, return steps |
| `disconnect()` | `Promise<void>` | Close CDP connection |
| `isRecording()` | `boolean` | Check if currently recording |
| `getFilterConfig()` | `FilterConfig` | Inspect the resolved filter configuration |

### Re-exports

The `recorder.ts` module re-exports everything needed for public use:

```typescript
// Types
export { RecorderOptions, RecordedStep, DomEvent, NetworkRequest, FilterConfig } from './types';

// Functions
export { correlate } from './correlator';
export { runPostFilters, scoreUserIntent } from './post-filters';
export { shouldCapture, isNoiseUrl, isNoiseResourceType, runCaptureFilters } from './filters';
```

---

## Testing

### Test suite overview

| File | Tests | Type | What It Tests |
|------|-------|------|---------------|
| `correlator.test.ts` | 14 | Unit | Timestamp correlation, pairing logic, descriptions, edge cases |
| `filters.test.ts` | 49 | Unit | Every capture filter (individually + pipeline + toggles) |
| `post-filters.test.ts` | 21 | Unit | User-intent scoring, same-origin filtering, combined pipeline |
| `dom-capture.test.ts` | 4 | Integration | Real headless Chrome, script injection, event capture |
| `network-capture.test.ts` | 3 | Integration | Real headless Chrome, request/response pairing |
| `integration.test.ts` | 2 | Integration | Full end-to-end: form fill → submit → capture → correlate |

**Total: 93 tests, 6 test files.**

### Running tests

```bash
# All tests (unit + integration — launches headless Chrome)
npm test

# Unit tests only (no Chrome needed, fast)
npm run test:unit

# Integration tests only (launches Chrome)
npm run test:integration

# Watch mode (re-runs on file changes)
npm run test:watch
```

### How integration tests work

Integration tests in `dom-capture.test.ts`, `network-capture.test.ts`, and `integration.test.ts` follow this pattern:

1. `chrome-launcher.ts` finds an installed Chrome binary (macOS and Linux paths searched).
2. Launches Chrome in `--headless=new` mode on a unique port with a temporary `--user-data-dir`.
3. `startTestServer()` starts an HTTP server that serves `test-fixtures/test-form.html` and accepts POST requests.
4. The test uses CDP to navigate to the test page, simulate user actions via `Runtime.evaluate()`, and assert on captured data.
5. Chrome process is killed and temp directory cleaned up in `afterAll`.

Each integration test file uses a **unique CDP port** to avoid conflicts when running in parallel.

### Test fixture (`test-fixtures/test-form.html`)

A simple HTML form with three fields (`username`, `email`, `message`) and a submit button. On submit, it sends a `POST /submit` via the Fetch API with `application/x-www-form-urlencoded` body. All interactive elements have `data-testid` attributes for selector verification.

---

## Design Decisions

### Why CDP, not a Chrome Extension?

A Chrome extension captures events from inside the browser, which limits it to manual user workflows. CDP enables:
- **Programmatic control** — tests can drive Chrome headlessly.
- **Server-side processing** — the Node.js process can run LLMs, write files, talk to APIs.
- **Terminal workflows** — no browser UI needed for automated pipelines.
- **Reliable testing** — integration tests launch Chrome, simulate actions, and assert results.

### Why `Runtime.addBinding` instead of polling?

Initially, DOM events were captured by injecting a script that buffered events in `window.__mcp_dom_events`, polled via `Runtime.evaluate()` every 500ms. This lost events during page navigations — the form submit event was fired, the page unloaded, and the next poll found an empty buffer on the new page.

`Runtime.addBinding()` creates a function on `window` that pushes data from the page to Node.js instantly (via CDP, not HTTP). The event is delivered before the page unloads, solving the data loss problem. A fallback poller is kept for edge cases where the binding isn't available (e.g., Chrome internal pages).

### Why `wallTime` instead of `timestamp`?

CDP's `requestWillBeSent` has two timestamp fields:
- **`timestamp`** — Monotonic clock (seconds since an unspecified Chrome-internal epoch). Different scale than `Date.now()`.
- **`wallTime`** — Unix epoch (seconds since Jan 1, 1970). Comparable with `Date.now()`.

Since DOM events use `Date.now()`, we must use `wallTime` for network timestamps. Otherwise, the correlator can't compare the two streams.

### Why capture-time AND post-recording filters?

- **Capture-time filters** run inside the `Network.requestWillBeSent` handler. They prevent noise from entering memory — important for long recording sessions on heavy commercial sites that generate hundreds of requests per minute.
- **Post-recording filters** run after correlation. They use the DOM↔Network pairing information (which isn't available during capture) to make smarter decisions — e.g., "this request has no corresponding user action, so it's probably background noise."

Both stages are needed because they have access to different information at different times.

### Why are post-filters OFF by default?

Conservative design. The recorder should capture everything by default so users can inspect the raw data and understand what's happening. Post-filters are opt-in (`--user-intent`, `--same-origin`) because they discard data — once discarded, it's gone. For MCP tool building, `--user-intent` is the recommended default.

---

## Known Limitations

| Limitation | Impact | Workaround |
|-----------|--------|------------|
| Single-tab only | Connects to the first `page` target; doesn't handle multi-tab workflows | Pass `tabUrl` parameter to `connect()` to target a specific tab |
| No response bodies | Captures status codes but not response content | Future: add `Network.getResponseBody()` calls |
| DOM events on Chrome internal pages | `chrome://newtab` uses Shadow DOM which limits selector generation | Events are captured but selectors may be generic (e.g., `ntp-app`) |
| Selector stability | CSS selectors may break if the page structure changes | Selector priority uses stable attributes first (`data-testid` > `id` > `aria-label` > `name`) |
| `input` events for every keystroke | Typing "Pizza" generates 5 separate `input` steps (P, Pi, Piz, Pizz, Pizza) | Future: debounce consecutive `input` events on the same element |
| Tracker blocklist incompleteness | Only 25 known domains; new trackers slip through | Use `--user-intent` filter which catches unknown trackers by behavior, not domain |

---

## Future Work

### Stage 2: Argument Tagging

Take the `RecordedStep[]` output and use an LLM or heuristic to identify which DOM events correspond to which network request parameters. For example: map the `inputValue: "Pizza"` from the DOM event on `input[name="custname"]` to `parsedBody.custname: "Pizza"` in the POST request. This produces a `TaggedStep[]` where each input field is linked to its corresponding API parameter.

### Stage 3: MCP Tool Generation

Generate MCP server tool definitions from `TaggedStep[]`, allowing agents to replay recorded workflows with different parameters.

### Improvements Under Consideration

- **Input debouncing** — Collapse consecutive `input` events on the same element into a single step with the final value.
- **Response body capture** — Use `Network.getResponseBody()` to capture API response data.
- **Multi-tab support** — Track multiple page targets simultaneously.
- **WebSocket capture** — Capture WebSocket frames for real-time applications.
- **Selector fallback chain** — Try CSS selector → XPath → visual coordinate for maximum resilience.

---

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Language | TypeScript (strict mode) | 5.3+ |
| Runtime | Node.js | 18+ |
| CDP Client | `chrome-remote-interface` | 0.33.2 |
| Test Runner | `vitest` | 1.2+ |
| TS Execution | `tsx` (for CLI) | 4.21+ |
| Compile Target | ES2022 / CommonJS | — |

---

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `npm test` | `vitest run` | Run all 93 tests |
| `npm run test:unit` | `vitest run tests/correlator... tests/filters... tests/post-filters...` | Unit tests only (no Chrome) |
| `npm run test:integration` | `vitest run tests/integration.test.ts` | Integration tests (launches Chrome) |
| `npm run test:watch` | `vitest` | Watch mode |
| `npm run build` | `tsc` | Compile TypeScript to `dist/` |
| `npm run dev` | `tsc --watch` | Watch mode compilation |
| `npm run cli` | `npx tsx src/cli.ts` | Run CLI directly from source |
