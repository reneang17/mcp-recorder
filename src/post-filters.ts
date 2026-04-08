// ─── Post-recording filters: run AFTER correlation on RecordedStep[] ───
//
// These filters use the correlation data (DOM ↔ Network pairing) to make
// smarter filtering decisions that aren't possible at capture time.
//
// See docs/filtering.md for full documentation.

import { RecordedStep, PostFilterConfig } from './types';

// ────────────────────────────────────────────────────────────────
// Point 5: User-intent scoring
// ────────────────────────────────────────────────────────────────
//
// Assigns a confidence score to each step based on whether it was
// triggered by a user action. Steps without user intent are noise.
//
// Scoring rules:
//   HIGH   — DOM event paired with network request (user did X → Y happened)
//   HIGH   — DOM event only (user clicked/typed, no API call resulted)
//   MEDIUM — Orphan Document request (page navigation, likely user-initiated)
//   LOW    — Orphan XHR/Fetch request (background noise, auto-triggered)

export type IntentScore = 'high' | 'medium' | 'low';

/**
 * Score a single step's user intent.
 */
export function scoreUserIntent(step: RecordedStep): IntentScore {
  const hasDom = step.domEvent !== null;
  const hasNet = step.networkRequest !== null;

  // Correlated steps: user action triggered a network request
  if (hasDom && hasNet) return 'high';

  // DOM-only: user interacted but no network call resulted
  if (hasDom && !hasNet) return 'high';

  // Network-only: no user action associated
  if (!hasDom && hasNet) {
    // Page navigation (Document type) is likely user-initiated
    // (they typed a URL or clicked a link that wasn't captured as a DOM event)
    if (step.networkRequest!.resourceType === 'Document') return 'medium';

    // Everything else (XHR/Fetch without DOM event) is background noise
    return 'low';
  }

  // Should never happen (step with neither DOM nor Network), but handle gracefully
  return 'low';
}

/**
 * Apply user-intent scoring to all steps.
 * Annotates each step with an intentScore field.
 * When filtering is enabled, drops 'low' scored steps.
 */
export function applyUserIntentFilter(
  steps: RecordedStep[],
  enabled: boolean,
  debug: boolean = false
): RecordedStep[] {
  const scored = steps.map((step) => ({
    ...step,
    intentScore: scoreUserIntent(step) as IntentScore,
  }));

  if (debug) {
    console.error('\n[post-filter:user-intent] Scoring results:');
    for (const step of scored) {
      const label = step.intentScore.toUpperCase().padEnd(6);
      console.error(`  ${label} [${step.index}] ${step.description}`);
    }
  }

  if (!enabled) {
    // Even when disabled, we still annotate scores (useful for inspection)
    return scored;
  }

  // Filter: keep only HIGH and MEDIUM
  const filtered = scored.filter((step) => {
    if (step.intentScore === 'low') {
      if (debug) {
        console.error(
          `  [post-filter:user-intent] DROPPED [${step.index}] ${step.description}`
        );
      }
      return false;
    }
    return true;
  });

  // Re-index after filtering
  return filtered.map((step, i) => ({ ...step, index: i }));
}

// ────────────────────────────────────────────────────────────────
// Point 6: Same-origin filtering
// ────────────────────────────────────────────────────────────────
//
// Only keep network requests that go to the same origin as the page
// where the user was interacting. Cross-origin requests are usually
// trackers, CDNs, or third-party services.
//
// Exceptions:
//   - Steps with no network request (DOM-only) are always kept
//   - Steps with correlated DOM events are always kept (user intent)
//   - Domains in the allowedDomains list are always kept

/**
 * Extract the origin (protocol + hostname) from a URL.
 * Returns null if URL can't be parsed.
 */
function getOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Check if a URL's hostname matches any of the allowed domains.
 */
function isAllowedDomain(url: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      return hostname === d || hostname.endsWith('.' + d);
    });
  } catch {
    return false;
  }
}

/**
 * Apply same-origin filtering to steps.
 * Uses the DOM event's URL (or the most recent page URL) as the reference origin.
 */
export function applySameOriginFilter(
  steps: RecordedStep[],
  enabled: boolean,
  allowedDomains: string[] = [],
  debug: boolean = false
): RecordedStep[] {
  if (!enabled) return steps;

  // Determine the "current page origin" by looking at DOM events
  // This tracks as the user navigates between pages
  let currentPageOrigin: string | null = null;

  const filtered = steps.filter((step) => {
    // Update page origin from DOM events
    if (step.domEvent?.url) {
      const newOrigin = getOrigin(step.domEvent.url);
      if (newOrigin) currentPageOrigin = newOrigin;
    }

    // DOM-only steps are always kept (no network request to filter)
    if (!step.networkRequest) return true;

    // Correlated steps (DOM + Network) are always kept — they represent user intent
    if (step.domEvent && step.networkRequest) return true;

    // For orphan network requests, check origin
    const requestOrigin = getOrigin(step.networkRequest.url);

    // If we can't determine origins, keep the step (be conservative)
    if (!currentPageOrigin || !requestOrigin) return true;

    // Same origin — keep
    if (requestOrigin === currentPageOrigin) {
      if (debug) {
        console.error(
          `  [post-filter:same-origin] KEEP [${step.index}] ${step.description} (same origin)`
        );
      }
      return true;
    }

    // Allowed domain exception — keep
    if (isAllowedDomain(step.networkRequest.url, allowedDomains)) {
      if (debug) {
        console.error(
          `  [post-filter:same-origin] KEEP [${step.index}] ${step.description} (allowed domain)`
        );
      }
      return true;
    }

    // Cross-origin orphan — drop
    if (debug) {
      console.error(
        `  [post-filter:same-origin] DROPPED [${step.index}] ${step.description} ` +
          `(origin "${requestOrigin}" ≠ page "${currentPageOrigin}")`
      );
    }
    return false;
  });

  // Re-index after filtering
  return filtered.map((step, i) => ({ ...step, index: i }));
}

// ────────────────────────────────────────────────────────────────
// Pipeline: runs all enabled post-filters in sequence
// ────────────────────────────────────────────────────────────────

/**
 * Run all post-recording filters on the correlated step array.
 *
 * Order matters:
 *   1. User-intent scoring first (always runs to annotate, filters if enabled)
 *   2. Same-origin filtering second (further narrows if enabled)
 */
export function runPostFilters(
  steps: RecordedStep[],
  config: PostFilterConfig,
  allowedDomains: string[] = [],
  debug: boolean = false
): RecordedStep[] {
  if (debug) {
    console.error('\n[post-filters] Running post-recording filters...');
    console.error(`  user-intent: ${config.userIntentOnly ? 'ON' : 'OFF (score-only)'}`);
    console.error(`  same-origin: ${config.sameOriginOnly ? 'ON' : 'OFF'}`);
    if (allowedDomains.length > 0) {
      console.error(`  allowed-domains: ${allowedDomains.join(', ')}`);
    }
  }

  let result = steps;

  // Step 1: User-intent scoring (always annotates, optionally filters)
  result = applyUserIntentFilter(result, config.userIntentOnly, debug);

  // Step 2: Same-origin filtering (only if enabled)
  result = applySameOriginFilter(result, config.sameOriginOnly, allowedDomains, debug);

  if (debug) {
    console.error(
      `\n[post-filters] Result: ${steps.length} steps → ${result.length} steps ` +
        `(${steps.length - result.length} removed)`
    );
  }

  return result;
}
