// ─── Correlator: pairs DOM events with network requests by timestamp ───

import { DomEvent, NetworkRequest, RecordedStep } from './types';
import crypto from 'crypto';

/**
 * Generate a unique step ID.
 */
function generateStepId(): string {
  return 'step_' + crypto.randomUUID();
}

/**
 * Generate a human-readable description for a recorded step.
 */
function describeStep(
  domEvent: DomEvent | null,
  networkRequest: NetworkRequest | null
): string {
  const parts: string[] = [];

  if (domEvent) {
    switch (domEvent.eventType) {
      case 'click':
        parts.push(
          `Clicked ${domEvent.tagName}` +
            (domEvent.innerText ? ` "${domEvent.innerText}"` : '') +
            ` (${domEvent.selector})`
        );
        break;
      case 'input':
        parts.push(
          `Typed "${domEvent.inputValue || ''}" into ${domEvent.tagName}` +
            ` (${domEvent.selector})`
        );
        break;
      case 'change':
        parts.push(
          `Changed ${domEvent.tagName}` +
            (domEvent.inputValue ? ` to "${domEvent.inputValue}"` : '') +
            ` (${domEvent.selector})`
        );
        break;
      case 'submit':
        parts.push(`Submitted form (${domEvent.selector})`);
        break;
      case 'keydown':
        parts.push(
          `Pressed key in ${domEvent.tagName} (${domEvent.selector})`
        );
        break;
      default:
        parts.push(`${domEvent.eventType} on ${domEvent.selector}`);
    }
  }

  if (networkRequest) {
    const url = new URL(networkRequest.url);
    const shortUrl = url.pathname + (url.search ? url.search : '');
    parts.push(
      `${networkRequest.method} ${shortUrl}` +
        (networkRequest.responseStatus
          ? ` → ${networkRequest.responseStatus}`
          : '')
    );
  }

  return parts.join(' → ') || 'Unknown step';
}

/**
 * Correlate DOM events and network requests into recorded steps.
 *
 * Algorithm:
 * 1. Sort both arrays by timestamp.
 * 2. For each network request, find the nearest preceding DOM event
 *    within the correlation window.
 * 3. A DOM event can only be paired with one network request (the first one).
 * 4. Orphan DOM events (no matching network request) become standalone steps.
 * 5. Orphan network requests (no matching DOM event) become standalone steps.
 */
export function correlate(
  domEvents: DomEvent[],
  networkRequests: NetworkRequest[],
  windowMs: number = 2000
): RecordedStep[] {
  // Sort by timestamp
  const sortedDom = [...domEvents].sort((a, b) => a.timestamp - b.timestamp);
  const sortedNet = [...networkRequests].sort(
    (a, b) => a.timestamp - b.timestamp
  );

  const usedDomIndices = new Set<number>();
  const usedNetIndices = new Set<number>();
  const pairs: {
    domEvent: DomEvent | null;
    networkRequest: NetworkRequest | null;
    timestamp: number;
  }[] = [];

  // For each network request, find nearest preceding DOM event
  for (let ni = 0; ni < sortedNet.length; ni++) {
    const netReq = sortedNet[ni];
    let bestDomIdx = -1;
    let bestTimeDiff = Infinity;

    for (let di = 0; di < sortedDom.length; di++) {
      if (usedDomIndices.has(di)) continue;

      const domEv = sortedDom[di];
      const timeDiff = netReq.timestamp - domEv.timestamp;

      // DOM event must precede the network request and be within window
      if (timeDiff >= 0 && timeDiff <= windowMs && timeDiff < bestTimeDiff) {
        bestTimeDiff = timeDiff;
        bestDomIdx = di;
      }
    }

    if (bestDomIdx >= 0) {
      usedDomIndices.add(bestDomIdx);
      usedNetIndices.add(ni);
      pairs.push({
        domEvent: sortedDom[bestDomIdx],
        networkRequest: netReq,
        timestamp: sortedDom[bestDomIdx].timestamp,
      });
    }
  }

  // Add orphan network requests (no matching DOM event)
  for (let ni = 0; ni < sortedNet.length; ni++) {
    if (!usedNetIndices.has(ni)) {
      pairs.push({
        domEvent: null,
        networkRequest: sortedNet[ni],
        timestamp: sortedNet[ni].timestamp,
      });
    }
  }

  // Add orphan DOM events (no matching network request)
  for (let di = 0; di < sortedDom.length; di++) {
    if (!usedDomIndices.has(di)) {
      pairs.push({
        domEvent: sortedDom[di],
        networkRequest: null,
        timestamp: sortedDom[di].timestamp,
      });
    }
  }

  // Sort all pairs by timestamp and create steps
  pairs.sort((a, b) => a.timestamp - b.timestamp);

  return pairs.map((pair, index) => ({
    id: generateStepId(),
    index,
    domEvent: pair.domEvent,
    networkRequest: pair.networkRequest,
    description: describeStep(pair.domEvent, pair.networkRequest),
  }));
}
