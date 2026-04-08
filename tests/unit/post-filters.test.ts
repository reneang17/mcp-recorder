// ─── Tests for post-recording filters (Points 5 + 6) ───

import { describe, it, expect } from 'vitest';
import {
  scoreUserIntent,
  applyUserIntentFilter,
  applySameOriginFilter,
  runPostFilters,
} from '../../src/post-filters';
import { RecordedStep, DomEvent, NetworkRequest } from '../../src/types';

// ── Test data factories ──

function makeDomEvent(overrides: Partial<DomEvent> = {}): DomEvent {
  return {
    id: 'dom_test_' + Math.random().toString(36).slice(2),
    eventType: 'click',
    timestamp: 1000,
    selector: '#btn',
    tagName: 'button',
    innerText: 'Click me',
    inputValue: null,
    ariaLabel: null,
    url: 'https://example.com/page',
    ...overrides,
  };
}

function makeNetworkRequest(
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return {
    requestId: 'req_' + Math.random().toString(36).slice(2),
    timestamp: 1500,
    method: 'POST',
    url: 'https://example.com/api/submit',
    requestHeaders: {},
    postData: null,
    parsedBody: null,
    bodyEncoding: 'none',
    responseStatus: 200,
    resourceType: 'XHR',
    ...overrides,
  };
}

function makeStep(overrides: Partial<RecordedStep> = {}): RecordedStep {
  return {
    id: 'step_test_' + Math.random().toString(36).slice(2),
    index: 0,
    domEvent: null,
    networkRequest: null,
    description: 'Test step',
    ...overrides,
  };
}

// ────────────────────────────────────────────────────────────────
// Point 5: User-intent scoring
// ────────────────────────────────────────────────────────────────

describe('User-Intent Scoring (Point 5)', () => {
  describe('scoreUserIntent', () => {
    it('scores correlated steps (DOM + Network) as high', () => {
      const step = makeStep({
        domEvent: makeDomEvent(),
        networkRequest: makeNetworkRequest(),
      });
      expect(scoreUserIntent(step)).toBe('high');
    });

    it('scores DOM-only steps as high', () => {
      const step = makeStep({
        domEvent: makeDomEvent({ eventType: 'click' }),
        networkRequest: null,
      });
      expect(scoreUserIntent(step)).toBe('high');
    });

    it('scores orphan Document requests as medium', () => {
      const step = makeStep({
        domEvent: null,
        networkRequest: makeNetworkRequest({ resourceType: 'Document' }),
      });
      expect(scoreUserIntent(step)).toBe('medium');
    });

    it('scores orphan XHR requests as low', () => {
      const step = makeStep({
        domEvent: null,
        networkRequest: makeNetworkRequest({ resourceType: 'XHR' }),
      });
      expect(scoreUserIntent(step)).toBe('low');
    });

    it('scores orphan Fetch requests as low', () => {
      const step = makeStep({
        domEvent: null,
        networkRequest: makeNetworkRequest({ resourceType: 'Fetch' }),
      });
      expect(scoreUserIntent(step)).toBe('low');
    });
  });

  describe('applyUserIntentFilter', () => {
    const steps: RecordedStep[] = [
      makeStep({
        index: 0,
        domEvent: makeDomEvent(),
        networkRequest: makeNetworkRequest(),
        description: 'Correlated (high)',
      }),
      makeStep({
        index: 1,
        domEvent: makeDomEvent(),
        description: 'DOM only (high)',
      }),
      makeStep({
        index: 2,
        networkRequest: makeNetworkRequest({ resourceType: 'Document' }),
        description: 'Document request (medium)',
      }),
      makeStep({
        index: 3,
        networkRequest: makeNetworkRequest({ resourceType: 'XHR' }),
        description: 'Orphan XHR (low)',
      }),
      makeStep({
        index: 4,
        networkRequest: makeNetworkRequest({ resourceType: 'Fetch' }),
        description: 'Orphan Fetch (low)',
      }),
    ];

    it('annotates all steps with scores when disabled', () => {
      const result = applyUserIntentFilter(steps, false);
      expect(result).toHaveLength(5); // All kept
      expect(result[0].intentScore).toBe('high');
      expect(result[1].intentScore).toBe('high');
      expect(result[2].intentScore).toBe('medium');
      expect(result[3].intentScore).toBe('low');
      expect(result[4].intentScore).toBe('low');
    });

    it('drops low-scored steps when enabled', () => {
      const result = applyUserIntentFilter(steps, true);
      expect(result).toHaveLength(3); // Only high + medium
      expect(result.every((s) => s.intentScore !== 'low')).toBe(true);
    });

    it('keeps correlated steps when enabled', () => {
      const result = applyUserIntentFilter(steps, true);
      expect(result.some((s) => s.description === 'Correlated (high)')).toBe(true);
    });

    it('keeps DOM-only steps when enabled', () => {
      const result = applyUserIntentFilter(steps, true);
      expect(result.some((s) => s.description === 'DOM only (high)')).toBe(true);
    });

    it('keeps Document requests when enabled', () => {
      const result = applyUserIntentFilter(steps, true);
      expect(result.some((s) => s.description === 'Document request (medium)')).toBe(
        true
      );
    });

    it('drops orphan XHR/Fetch when enabled', () => {
      const result = applyUserIntentFilter(steps, true);
      expect(result.some((s) => s.description === 'Orphan XHR (low)')).toBe(false);
      expect(result.some((s) => s.description === 'Orphan Fetch (low)')).toBe(false);
    });

    it('re-indexes steps after filtering', () => {
      const result = applyUserIntentFilter(steps, true);
      result.forEach((step, i) => {
        expect(step.index).toBe(i);
      });
    });
  });
});

// ────────────────────────────────────────────────────────────────
// Point 6: Same-origin filtering
// ────────────────────────────────────────────────────────────────

describe('Same-Origin Filtering (Point 6)', () => {
  const steps: RecordedStep[] = [
    // DOM event establishes the page origin as example.com
    makeStep({
      index: 0,
      domEvent: makeDomEvent({ url: 'https://example.com/page' }),
      description: 'Click on example.com',
    }),
    // Same-origin API call (should keep)
    makeStep({
      index: 1,
      networkRequest: makeNetworkRequest({ url: 'https://example.com/api/data' }),
      description: 'Same-origin API call',
    }),
    // Cross-origin tracker (should drop)
    makeStep({
      index: 2,
      networkRequest: makeNetworkRequest({
        url: 'https://analytics.google.com/collect',
      }),
      description: 'Cross-origin tracker',
    }),
    // Cross-origin but allowed domain (should keep)
    makeStep({
      index: 3,
      networkRequest: makeNetworkRequest({
        url: 'https://api.stripe.com/v1/payment',
      }),
      description: 'Allowed cross-origin',
    }),
    // Correlated cross-origin (should keep — has DOM event = user intent)
    makeStep({
      index: 4,
      domEvent: makeDomEvent({ url: 'https://example.com/checkout' }),
      networkRequest: makeNetworkRequest({
        url: 'https://cdn.example.net/api/order',
      }),
      description: 'Correlated cross-origin',
    }),
  ];

  it('does nothing when disabled', () => {
    const result = applySameOriginFilter(steps, false);
    expect(result).toHaveLength(5);
  });

  it('keeps same-origin requests', () => {
    const result = applySameOriginFilter(steps, true, ['api.stripe.com']);
    expect(result.some((s) => s.description === 'Same-origin API call')).toBe(true);
  });

  it('drops cross-origin orphan requests', () => {
    const result = applySameOriginFilter(steps, true, ['api.stripe.com']);
    expect(result.some((s) => s.description === 'Cross-origin tracker')).toBe(false);
  });

  it('keeps allowed domains', () => {
    const result = applySameOriginFilter(steps, true, ['api.stripe.com']);
    expect(result.some((s) => s.description === 'Allowed cross-origin')).toBe(true);
  });

  it('keeps correlated cross-origin steps (user intent)', () => {
    const result = applySameOriginFilter(steps, true, ['api.stripe.com']);
    expect(
      result.some((s) => s.description === 'Correlated cross-origin')
    ).toBe(true);
  });

  it('keeps DOM-only steps', () => {
    const result = applySameOriginFilter(steps, true);
    expect(result.some((s) => s.description === 'Click on example.com')).toBe(true);
  });

  it('re-indexes steps after filtering', () => {
    const result = applySameOriginFilter(steps, true, ['api.stripe.com']);
    result.forEach((step, i) => {
      expect(step.index).toBe(i);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// Combined pipeline
// ────────────────────────────────────────────────────────────────

describe('Post-filter pipeline (runPostFilters)', () => {
  it('applies both filters in sequence when both enabled', () => {
    const steps: RecordedStep[] = [
      // DOM click — high intent, same origin (KEEP)
      makeStep({
        index: 0,
        domEvent: makeDomEvent({ url: 'https://example.com' }),
        description: 'User click',
      }),
      // Orphan XHR same-origin — low intent (DROP by user-intent)
      makeStep({
        index: 1,
        networkRequest: makeNetworkRequest({
          url: 'https://example.com/api/heartbeat',
          resourceType: 'XHR',
        }),
        description: 'Same-origin heartbeat',
      }),
      // Orphan Fetch cross-origin — low intent (DROP by user-intent)
      makeStep({
        index: 2,
        networkRequest: makeNetworkRequest({
          url: 'https://tracker.com/collect',
          resourceType: 'Fetch',
        }),
        description: 'Cross-origin tracker',
      }),
      // Orphan Document same-origin — medium intent (KEEP)
      makeStep({
        index: 3,
        networkRequest: makeNetworkRequest({
          url: 'https://example.com/page2',
          resourceType: 'Document',
        }),
        description: 'Page navigation',
      }),
    ];

    const result = runPostFilters(
      steps,
      { userIntentOnly: true, sameOriginOnly: true },
      []
    );

    expect(result).toHaveLength(2);
    expect(result[0].description).toBe('User click');
    expect(result[1].description).toBe('Page navigation');
  });

  it('returns all steps when both filters are disabled', () => {
    const steps = [
      makeStep({ index: 0 }),
      makeStep({ index: 1 }),
    ];

    const result = runPostFilters(
      steps,
      { userIntentOnly: false, sameOriginOnly: false }
    );

    expect(result).toHaveLength(2);
  });
});
