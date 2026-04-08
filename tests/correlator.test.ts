// ─── Test 3: Correlator unit tests ───

import { describe, it, expect } from 'vitest';
import { correlate } from '../src/correlator';
import { DomEvent, NetworkRequest } from '../src/types';

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
});
