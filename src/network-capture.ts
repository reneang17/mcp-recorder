// ─── Network domain listener: request/response pairing and filtering ───

import { NetworkRequest, RecorderOptions } from './types';
import { runCaptureFilters, CaptureFilterResult } from './filters';
import { CDPConnection } from './cdp-client';

// ────────────────────────────────────────────────────────────────
// Standalone parsing functions (exported for unit testing)
// ────────────────────────────────────────────────────────────────

/**
 * Extract content-type from headers (case-insensitive).
 */
export function getContentType(headers: Record<string, string>): string {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'content-type') {
      return value.toLowerCase();
    }
  }
  return '';
}

/**
 * Parse POST body into a structured object if possible.
 */
export function parseBody(
  postData: string | null | undefined,
  headers: Record<string, string>
): Record<string, any> | null {
  if (!postData) return null;

  const contentType = getContentType(headers);

  // Try JSON
  if (contentType.includes('json')) {
    try {
      return JSON.parse(postData);
    } catch {
      return null;
    }
  }

  // Try form-urlencoded
  if (contentType.includes('x-www-form-urlencoded')) {
    try {
      const params = new URLSearchParams(postData);
      const result: Record<string, string> = {};
      for (const [key, value] of params) {
        result[key] = value;
      }
      return result;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Detect the body encoding type.
 */
export function detectEncoding(
  postData: string | null | undefined,
  headers: Record<string, string>
): NetworkRequest['bodyEncoding'] {
  if (!postData) return 'none';

  const contentType = getContentType(headers);

  if (contentType.includes('json')) return 'json';
  if (contentType.includes('x-www-form-urlencoded')) return 'form-urlencoded';
  if (contentType.includes('multipart')) return 'multipart';
  return 'text';
}

/**
 * Manages CDP Network domain capture.
 * Pairs requestWillBeSent with responseReceived by requestId.
 * Applies capture-time filters to discard noise before storing.
 */
export class NetworkCapture {
  private requests: Map<string, NetworkRequest> = new Map();
  private capturedRequests: NetworkRequest[] = [];
  private options: RecorderOptions;
  private connection: CDPConnection | null = null;

  constructor(options: RecorderOptions) {
    this.options = options;
  }

  /**
   * Enable the Network domain and start listening.
   */
  async start(connection: CDPConnection): Promise<void> {
    this.connection = connection;
    this.requests.clear();
    this.capturedRequests = [];

    const { Network } = connection;
    const debug = this.options.filters.debug;

    // Listen for outgoing requests
    Network.requestWillBeSent((params: any) => {
      const { requestId, request, wallTime, type } = params;
      const resourceType = type || 'Other';

      // Run the capture filter pipeline
      if (debug) {
        console.error(`\n[network] Request: ${request.method} ${request.url}`);
      }

      const filterResult: CaptureFilterResult = runCaptureFilters(
        request.url,
        request.method,
        resourceType,
        this.options.captureResourceTypes,
        this.options.filters.captureFilters,
        debug
      );

      if (!filterResult.keep) {
        if (debug) {
          console.error(
            `  → DISCARDED by "${filterResult.rejectedBy}": ${filterResult.reason}`
          );
        }
        return;
      }

      const netReq: NetworkRequest = {
        requestId,
        timestamp: wallTime * 1000, // wallTime is Unix epoch seconds → ms (matches Date.now())
        method: request.method,
        url: request.url,
        requestHeaders: request.headers || {},
        postData: request.postData || null,
        parsedBody: parseBody(request.postData, request.headers),
        bodyEncoding: detectEncoding(request.postData, request.headers),
        responseStatus: null,
        resourceType,
      };

      this.requests.set(requestId, netReq);
    });

    // Listen for responses to pair with requests
    Network.responseReceived((params: any) => {
      const { requestId, response } = params;
      const existing = this.requests.get(requestId);

      if (existing) {
        existing.responseStatus = response.status;
        // Move to captured list
        this.capturedRequests.push(existing);
        this.requests.delete(requestId);
      }
    });

    // Handle failed/cancelled requests — still capture them
    Network.loadingFailed((params: any) => {
      const { requestId } = params;
      const existing = this.requests.get(requestId);
      if (existing) {
        existing.responseStatus = 0; // Indicate failure
        this.capturedRequests.push(existing);
        this.requests.delete(requestId);
      }
    });

    await Network.enable({});
  }

  /**
   * Stop listening and return all captured requests.
   */
  async stop(): Promise<NetworkRequest[]> {
    // Flush any pending requests that never got a response
    for (const [, req] of this.requests) {
      this.capturedRequests.push(req);
    }
    this.requests.clear();

    if (this.connection) {
      try {
        await this.connection.Network.disable();
      } catch {
        // Ignore disable errors
      }
    }

    return [...this.capturedRequests];
  }

}
