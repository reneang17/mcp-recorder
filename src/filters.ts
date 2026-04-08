// ─── Capture-time filters: run DURING recording to discard noise early ───
//
// Architecture:
//   Each filter is a named, independent function.
//   The pipeline runs all enabled filters in order.
//   When debug mode is on, every decision is logged to stderr.
//
// See docs/filtering.md for full documentation.

import { CaptureFilterConfig } from './types';

// ────────────────────────────────────────────────────────────────
// Filter result — every filter decision is traceable
// ────────────────────────────────────────────────────────────────

export interface CaptureFilterResult {
  /** True = keep this request. False = discard it. */
  keep: boolean;
  /** Name of the filter that rejected this request (null if kept) */
  rejectedBy: string | null;
  /** Human-readable explanation (useful for debugging) */
  reason: string;
}

// ────────────────────────────────────────────────────────────────
// Filter 1: Blocked protocols
// ────────────────────────────────────────────────────────────────

const BLOCKED_PROTOCOLS = ['chrome-extension:', 'data:', 'blob:', 'devtools:'];

export function filterProtocols(url: string): CaptureFilterResult {
  for (const proto of BLOCKED_PROTOCOLS) {
    if (url.startsWith(proto)) {
      return {
        keep: false,
        rejectedBy: 'protocols',
        reason: `URL starts with blocked protocol "${proto}"`,
      };
    }
  }
  return { keep: true, rejectedBy: null, reason: 'No blocked protocol found' };
}

// ────────────────────────────────────────────────────────────────
// Filter 2: Known tracker domains
// ────────────────────────────────────────────────────────────────

const BLOCKED_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'facebook.com',
  'connect.facebook.net',
  'doubleclick.net',
  'googlesyndication.com',
  'googleadservices.com',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'mixpanel.com',
  'amplitude.com',
  'sentry.io',
  'newrelic.com',
  'nr-data.net',
  'fullstory.com',
  'clarity.ms',
  'demdex.net',
  'optimizely.com',
  'crazyegg.com',
  'mouseflow.com',
  'heapanalytics.com',
  'intercom.io',
  'intercomcdn.com',
  'hubspot.com',
  'hs-analytics.net',
];

export function filterTrackerDomains(url: string): CaptureFilterResult {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    for (const domain of BLOCKED_DOMAINS) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return {
          keep: false,
          rejectedBy: 'tracker-domains',
          reason: `Hostname "${hostname}" matches blocked tracker domain "${domain}"`,
        };
      }
    }
  } catch {
    // Unparseable URLs pass through
  }

  return { keep: true, rejectedBy: null, reason: 'Not a known tracker domain' };
}

// ────────────────────────────────────────────────────────────────
// Filter 3: Resource types (CDP-level classification)
// ────────────────────────────────────────────────────────────────

const BLOCKED_RESOURCE_TYPES = [
  'Image',
  'Font',
  'Media',
  'Stylesheet',
  'Manifest',
  'Ping',
  'Preflight',
  'CSPViolationReport',
  'Other',
];

export function filterResourceTypes(
  resourceType: string,
  allowedTypes: string[]
): CaptureFilterResult {
  // First check the global blocklist
  if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) {
    return {
      keep: false,
      rejectedBy: 'resource-types',
      reason: `Resource type "${resourceType}" is blocked`,
    };
  }

  // Then check the user's allowed list (if specified)
  if (allowedTypes.length > 0 && !allowedTypes.includes(resourceType)) {
    return {
      keep: false,
      rejectedBy: 'resource-types',
      reason: `Resource type "${resourceType}" not in allowed list [${allowedTypes.join(', ')}]`,
    };
  }

  return { keep: true, rejectedBy: null, reason: `Resource type "${resourceType}" is allowed` };
}

// ────────────────────────────────────────────────────────────────
// Filter 4: Static asset file extensions
// ────────────────────────────────────────────────────────────────

const BLOCKED_EXTENSIONS = [
  /favicon\.ico$/i,
  /\.woff2?$/i,
  /\.ttf$/i,
  /\.eot$/i,
  /\.otf$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.svg$/i,
  /\.webp$/i,
  /\.avif$/i,
  /\.ico$/i,
  /\.mp4$/i,
  /\.webm$/i,
  /\.mp3$/i,
  /\.ogg$/i,
];

export function filterFileExtensions(url: string): CaptureFilterResult {
  try {
    const pathname = new URL(url).pathname;
    for (const pattern of BLOCKED_EXTENSIONS) {
      if (pattern.test(pathname)) {
        return {
          keep: false,
          rejectedBy: 'file-extensions',
          reason: `URL path "${pathname}" matches blocked extension pattern`,
        };
      }
    }
  } catch {
    // Unparseable URLs pass through
  }

  return { keep: true, rejectedBy: null, reason: 'No blocked file extension' };
}

// ────────────────────────────────────────────────────────────────
// Filter 5: OPTIONS preflight (Point 3)
// ────────────────────────────────────────────────────────────────

export function filterOptionsPreflight(method: string): CaptureFilterResult {
  if (method === 'OPTIONS') {
    return {
      keep: false,
      rejectedBy: 'options-preflight',
      reason: 'CORS preflight OPTIONS request — never part of user workflow',
    };
  }
  return { keep: true, rejectedBy: null, reason: 'Not an OPTIONS request' };
}

// ────────────────────────────────────────────────────────────────
// Pipeline: runs all enabled capture filters in sequence
// ────────────────────────────────────────────────────────────────

/**
 * Run all enabled capture-time filters against a request.
 *
 * Returns the first filter that rejects the request, or a "keep" result.
 * When debug=true, logs every filter decision to stderr.
 */
export function runCaptureFilters(
  url: string,
  method: string,
  resourceType: string,
  allowedResourceTypes: string[],
  config: CaptureFilterConfig,
  debug: boolean = false
): CaptureFilterResult {
  // Define the filter pipeline — order matters for performance.
  // Cheapest checks first (string prefix), expensive checks last (URL parsing).
  const pipeline: Array<{
    name: string;
    enabled: boolean;
    run: () => CaptureFilterResult;
  }> = [
    {
      name: 'options-preflight',
      enabled: config.optionsPreflight,
      run: () => filterOptionsPreflight(method),
    },
    {
      name: 'protocols',
      enabled: config.protocols,
      run: () => filterProtocols(url),
    },
    {
      name: 'resource-types',
      enabled: config.resourceTypes,
      run: () => filterResourceTypes(resourceType, allowedResourceTypes),
    },
    {
      name: 'file-extensions',
      enabled: config.fileExtensions,
      run: () => filterFileExtensions(url),
    },
    {
      name: 'tracker-domains',
      enabled: config.trackerDomains,
      run: () => filterTrackerDomains(url),
    },
  ];

  for (const filter of pipeline) {
    if (!filter.enabled) {
      if (debug) {
        console.error(`  [filter:${filter.name}] SKIPPED (disabled)`);
      }
      continue;
    }

    const result = filter.run();

    if (debug) {
      const status = result.keep ? 'PASS' : 'REJECT';
      console.error(`  [filter:${filter.name}] ${status} — ${result.reason}`);
    }

    if (!result.keep) {
      return result;
    }
  }

  return { keep: true, rejectedBy: null, reason: 'Passed all capture filters' };
}

// ────────────────────────────────────────────────────────────────
// Legacy API — kept for backward compatibility with existing tests
// ────────────────────────────────────────────────────────────────

/** Returns true if the URL is noise (should be filtered out). */
export function isNoiseUrl(url: string): boolean {
  const protoResult = filterProtocols(url);
  if (!protoResult.keep) return true;

  const domainResult = filterTrackerDomains(url);
  if (!domainResult.keep) return true;

  const extResult = filterFileExtensions(url);
  if (!extResult.keep) return true;

  return false;
}

/** Returns true if the resource type is noise. */
export function isNoiseResourceType(resourceType: string): boolean {
  return BLOCKED_RESOURCE_TYPES.includes(resourceType);
}

/** Returns true if the request should be captured (not noise). */
export function shouldCapture(
  url: string,
  resourceType: string,
  allowedResourceTypes: string[]
): boolean {
  if (isNoiseUrl(url)) return false;
  if (isNoiseResourceType(resourceType)) return false;
  if (
    allowedResourceTypes.length > 0 &&
    !allowedResourceTypes.includes(resourceType)
  ) {
    return false;
  }
  return true;
}
