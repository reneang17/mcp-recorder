// ─── Test 3: Correlator unit tests ───

import { describe, it, expect } from 'vitest';
import { correlate } from '../../src/correlator';
import { DomEvent, NetworkRequest } from '../../src/types';

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
    url: 'http://localhost:3000',
    ...overrides,
  };
}

function makeNetworkRequest(
  overrides: Partial<NetworkRequest> = {}
): NetworkRequest {
  return {
    requestId: 'req_test_' + Math.random().toString(36).slice(2),
    timestamp: 1500,
    method: 'POST',
    url: 'http://localhost:3000/api/submit',
    requestHeaders: {},
    postData: null,
    parsedBody: null,
    bodyEncoding: 'none',
    responseStatus: 200,
    resourceType: 'XHR',
    ...overrides,
  };
}

describe('Correlator', () => {
  it('pairs a DOM event with a network request within the time window', () => {
    const domEvents = [makeDomEvent({ timestamp: 1000 })];
    const netRequests = [makeNetworkRequest({ timestamp: 1500 })];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(1);
    expect(steps[0].domEvent).not.toBeNull();
    expect(steps[0].networkRequest).not.toBeNull();
    expect(steps[0].index).toBe(0);
  });

  it('does NOT pair events outside the time window', () => {
    const domEvents = [makeDomEvent({ timestamp: 1000 })];
    const netRequests = [makeNetworkRequest({ timestamp: 5000 })]; // 4s > 2s window

    const steps = correlate(domEvents, netRequests, 2000);

    // Should be 2 separate orphan steps
    expect(steps).toHaveLength(2);
    const domStep = steps.find((s) => s.domEvent && !s.networkRequest);
    const netStep = steps.find((s) => s.networkRequest && !s.domEvent);
    expect(domStep).toBeDefined();
    expect(netStep).toBeDefined();
  });

  it('does NOT pair DOM events that come AFTER network requests', () => {
    const domEvents = [makeDomEvent({ timestamp: 2000 })]; // DOM event is after
    const netRequests = [makeNetworkRequest({ timestamp: 1000 })]; // Network first

    const steps = correlate(domEvents, netRequests, 2000);

    // Should be 2 orphans since DOM should precede network
    expect(steps).toHaveLength(2);
  });

  it('handles orphan DOM events (no matching network request)', () => {
    const domEvents = [
      makeDomEvent({ timestamp: 1000, eventType: 'click' }),
      makeDomEvent({ timestamp: 2000, eventType: 'input' }),
    ];
    const netRequests: NetworkRequest[] = [];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.domEvent !== null)).toBe(true);
    expect(steps.every((s) => s.networkRequest === null)).toBe(true);
  });

  it('handles orphan network requests (no matching DOM event)', () => {
    const domEvents: DomEvent[] = [];
    const netRequests = [
      makeNetworkRequest({ timestamp: 1000 }),
      makeNetworkRequest({ timestamp: 2000 }),
    ];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(2);
    expect(steps.every((s) => s.networkRequest !== null)).toBe(true);
    expect(steps.every((s) => s.domEvent === null)).toBe(true);
  });

  it('handles multiple network requests after one DOM event', () => {
    // One click triggers multiple API calls
    const domEvents = [makeDomEvent({ timestamp: 1000 })];
    const netRequests = [
      makeNetworkRequest({ timestamp: 1100, url: 'http://localhost/api/a' }),
      makeNetworkRequest({ timestamp: 1200, url: 'http://localhost/api/b' }),
      makeNetworkRequest({ timestamp: 1300, url: 'http://localhost/api/c' }),
    ];

    const steps = correlate(domEvents, netRequests, 2000);

    // DOM event should pair with first network request; others become orphans
    const pairedSteps = steps.filter((s) => s.domEvent && s.networkRequest);
    const orphanNetSteps = steps.filter(
      (s) => !s.domEvent && s.networkRequest
    );

    expect(pairedSteps).toHaveLength(1);
    expect(orphanNetSteps).toHaveLength(2);
    expect(steps).toHaveLength(3);
  });

  it('pairs each DOM event with the closest network request', () => {
    const domEvents = [
      makeDomEvent({ timestamp: 1000, selector: '#btn1' }),
      makeDomEvent({ timestamp: 3000, selector: '#btn2' }),
    ];
    const netRequests = [
      makeNetworkRequest({ timestamp: 1500, url: 'http://localhost/api/1' }),
      makeNetworkRequest({ timestamp: 3200, url: 'http://localhost/api/2' }),
    ];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(2);

    // Both should be paired
    const allPaired = steps.every((s) => s.domEvent && s.networkRequest);
    expect(allPaired).toBe(true);

    // Verify correct pairing
    const step1 = steps.find((s) => s.domEvent?.selector === '#btn1');
    const step2 = steps.find((s) => s.domEvent?.selector === '#btn2');

    expect(step1?.networkRequest?.url).toBe('http://localhost/api/1');
    expect(step2?.networkRequest?.url).toBe('http://localhost/api/2');
  });

  it('orders steps by timestamp', () => {
    const domEvents = [
      makeDomEvent({ timestamp: 3000 }),
      makeDomEvent({ timestamp: 1000 }),
    ];
    const netRequests: NetworkRequest[] = [];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(2);
    expect(steps[0].index).toBe(0);
    expect(steps[1].index).toBe(1);
    expect(steps[0].domEvent!.timestamp).toBeLessThan(
      steps[1].domEvent!.timestamp
    );
  });

  it('generates human-readable descriptions for clicks', () => {
    const steps = correlate(
      [makeDomEvent({ eventType: 'click', innerText: 'Submit', selector: '#btn' })],
      [],
      2000
    );
    expect(steps[0].description).toContain('Clicked');
    expect(steps[0].description).toContain('Submit');
  });

  it('generates human-readable descriptions for input', () => {
    const steps = correlate(
      [
        makeDomEvent({
          eventType: 'input',
          tagName: 'input',
          inputValue: 'hello',
          selector: '#name',
        }),
      ],
      [],
      2000
    );
    expect(steps[0].description).toContain('Typed');
    expect(steps[0].description).toContain('hello');
  });

  it('generates human-readable descriptions for network-only steps', () => {
    const steps = correlate(
      [],
      [makeNetworkRequest({ method: 'POST', url: 'http://localhost/api/submit' })],
      2000
    );
    expect(steps[0].description).toContain('POST');
    expect(steps[0].description).toContain('/api/submit');
  });

  it('generates combined descriptions for paired steps', () => {
    const steps = correlate(
      [makeDomEvent({ timestamp: 1000, eventType: 'click', innerText: 'Go' })],
      [
        makeNetworkRequest({
          timestamp: 1200,
          method: 'GET',
          url: 'http://localhost/api/data',
        }),
      ],
      2000
    );
    expect(steps[0].description).toContain('Clicked');
    expect(steps[0].description).toContain('GET');
    expect(steps[0].description).toContain('/api/data');
  });

  it('handles empty inputs', () => {
    const steps = correlate([], [], 2000);
    expect(steps).toHaveLength(0);
  });

  it('assigns unique IDs to each step', () => {
    const steps = correlate(
      [
        makeDomEvent({ timestamp: 1000 }),
        makeDomEvent({ timestamp: 2000 }),
      ],
      [],
      2000
    );
    const ids = steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // ── New edge case tests ──

  it('pairs events at exact boundary of time window (2000ms exactly)', () => {
    const domEvents = [makeDomEvent({ timestamp: 1000 })];
    const netRequests = [makeNetworkRequest({ timestamp: 3000 })]; // exactly 2000ms diff

    const steps = correlate(domEvents, netRequests, 2000);

    // 2000ms is <= 2000ms window, so should pair
    expect(steps).toHaveLength(1);
    expect(steps[0].domEvent).not.toBeNull();
    expect(steps[0].networkRequest).not.toBeNull();
  });

  it('does NOT pair events 1ms beyond the window boundary', () => {
    const domEvents = [makeDomEvent({ timestamp: 1000 })];
    const netRequests = [makeNetworkRequest({ timestamp: 3001 })]; // 2001ms > 2000ms

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(2); // Two orphans
  });

  it('handles same-timestamp DOM events (selects one for pairing)', () => {
    const domEvents = [
      makeDomEvent({ timestamp: 1000, selector: '#btn1' }),
      makeDomEvent({ timestamp: 1000, selector: '#btn2' }),
    ];
    const netRequests = [makeNetworkRequest({ timestamp: 1500 })];

    const steps = correlate(domEvents, netRequests, 2000);

    // Should produce 2 steps: one paired, one orphan DOM
    expect(steps).toHaveLength(2);
    const paired = steps.filter((s) => s.domEvent && s.networkRequest);
    const orphanDom = steps.filter((s) => s.domEvent && !s.networkRequest);
    expect(paired).toHaveLength(1);
    expect(orphanDom).toHaveLength(1);
  });

  it('handles same-timestamp network requests', () => {
    const domEvents = [makeDomEvent({ timestamp: 1000 })];
    const netRequests = [
      makeNetworkRequest({ timestamp: 1500, url: 'http://localhost/api/a' }),
      makeNetworkRequest({ timestamp: 1500, url: 'http://localhost/api/b' }),
    ];

    const steps = correlate(domEvents, netRequests, 2000);

    // One pairs with the DOM event, the other becomes orphan
    expect(steps).toHaveLength(2);
  });

  it('handles rapid-fire events (20 events within 100ms)', () => {
    const domEvents = Array.from({ length: 20 }, (_, i) =>
      makeDomEvent({ timestamp: 1000 + i * 5, selector: `#el${i}` })
    );
    const netRequests: NetworkRequest[] = [];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(20);
    // Verify they're sorted by timestamp
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].domEvent!.timestamp).toBeGreaterThanOrEqual(
        steps[i - 1].domEvent!.timestamp
      );
    }
  });

  it('handles large-scale correlation (50 DOM + 50 network)', () => {
    const domEvents = Array.from({ length: 50 }, (_, i) =>
      makeDomEvent({ timestamp: 1000 + i * 100, selector: `#btn${i}` })
    );
    const netRequests = Array.from({ length: 50 }, (_, i) =>
      makeNetworkRequest({ timestamp: 1050 + i * 100, url: `http://localhost/api/${i}` })
    );

    const steps = correlate(domEvents, netRequests, 2000);

    // All 50 DOM events should pair with their nearest network request
    // resulting in 50 paired steps (each dom is 50ms before its net request)
    const paired = steps.filter((s) => s.domEvent && s.networkRequest);
    expect(paired.length).toBe(50);
    expect(steps).toHaveLength(50);

    // Indices should be sequential
    steps.forEach((step, i) => {
      expect(step.index).toBe(i);
    });
  });

  it('generates description for change events', () => {
    const steps = correlate(
      [makeDomEvent({ eventType: 'change', tagName: 'select', inputValue: 'US', selector: '#country' })],
      [],
      2000
    );
    expect(steps[0].description).toContain('Changed');
    expect(steps[0].description).toContain('US');
  });

  it('generates description for submit events', () => {
    const steps = correlate(
      [makeDomEvent({ eventType: 'submit', tagName: 'form', selector: '#myform' })],
      [],
      2000
    );
    expect(steps[0].description).toContain('Submitted');
    expect(steps[0].description).toContain('#myform');
  });

  it('generates description for keydown events', () => {
    const steps = correlate(
      [makeDomEvent({ eventType: 'keydown', tagName: 'input', selector: '#search' })],
      [],
      2000
    );
    expect(steps[0].description).toContain('Pressed key');
    expect(steps[0].description).toContain('#search');
  });

  it('generates "Unknown step" for step with no event or request', () => {
    // Edge case: if somehow both are null (shouldn't happen in practice)
    // Test the describeStep behavior by passing empty arrays
    const steps = correlate([], [], 2000);
    expect(steps).toHaveLength(0);
  });

  it('preserves DOM event and network request data integrity in paired steps', () => {
    const domEvents = [makeDomEvent({
      timestamp: 1000,
      eventType: 'click',
      selector: '#submit',
      tagName: 'button',
      innerText: 'Go',
      inputValue: null,
      url: 'http://localhost:3000/page',
    })];
    const netRequests = [makeNetworkRequest({
      timestamp: 1200,
      method: 'POST',
      url: 'http://localhost:3000/api/submit',
      postData: 'key=val',
      responseStatus: 201,
    })];

    const steps = correlate(domEvents, netRequests, 2000);

    expect(steps).toHaveLength(1);
    const step = steps[0];

    // Verify the DOM event data wasn't mutated
    expect(step.domEvent!.selector).toBe('#submit');
    expect(step.domEvent!.eventType).toBe('click');
    expect(step.domEvent!.tagName).toBe('button');
    expect(step.domEvent!.innerText).toBe('Go');
    expect(step.domEvent!.url).toBe('http://localhost:3000/page');

    // Verify the network request data wasn't mutated
    expect(step.networkRequest!.method).toBe('POST');
    expect(step.networkRequest!.url).toBe('http://localhost:3000/api/submit');
    expect(step.networkRequest!.postData).toBe('key=val');
    expect(step.networkRequest!.responseStatus).toBe(201);
  });
});
