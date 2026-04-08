// ─── Core data types for the MCP Recording Engine ───

// ────────────────────────────────────────────────────────────────
// Domain types — what we record
// ────────────────────────────────────────────────────────────────

export interface DomEvent {
  id: string;
  eventType: 'click' | 'input' | 'change' | 'submit' | 'keydown';
  timestamp: number;
  selector: string;
  tagName: string;
  innerText: string; // truncated to 100 chars
  inputValue: string | null;
  ariaLabel: string | null;
  url: string; // page URL at time of event
}

export interface NetworkRequest {
  requestId: string;
  timestamp: number;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  postData: string | null;
  parsedBody: Record<string, any> | null;
  bodyEncoding: 'json' | 'form-urlencoded' | 'multipart' | 'text' | 'none';
  responseStatus: number | null;
  resourceType: string;
}

export interface RecordedStep {
  id: string;
  index: number;
  domEvent: DomEvent | null;
  networkRequest: NetworkRequest | null;
  description: string;
  /** Confidence that this step represents intentional user action. Set by post-filters. */
  intentScore?: 'high' | 'medium' | 'low';
  /** If the step was filtered out, which filter removed it and why. */
  filteredBy?: string;
}

// ────────────────────────────────────────────────────────────────
// Filter configuration — each filter is independently toggleable
// ────────────────────────────────────────────────────────────────

/**
 * Controls which capture-time filters are active.
 *
 * Capture-time filters run DURING recording, inside the Network event handler.
 * They prevent noise from ever being stored in memory.
 * Each filter can be toggled independently for debugging.
 */
export interface CaptureFilterConfig {
  /** Block chrome-extension://, data:, blob:, devtools: URLs */
  protocols: boolean;
  /** Block known analytics/tracking domains (Google Analytics, Facebook, etc.) */
  trackerDomains: boolean;
  /** Block non-relevant resource types (Image, Font, Stylesheet, etc.) */
  resourceTypes: boolean;
  /** Block static asset URLs by file extension (.png, .woff2, .ico, etc.) */
  fileExtensions: boolean;
  /** Block CORS preflight OPTIONS requests (Point 3) */
  optionsPreflight: boolean;
}

/**
 * Controls which post-recording filters are active.
 *
 * Post-recording filters run AFTER correlation, on the final RecordedStep[] array.
 * They use the correlation data (DOM ↔ Network pairing) to make smarter decisions.
 */
export interface PostFilterConfig {
  /** Drop orphan network requests not correlated with any user action (Point 5) */
  userIntentOnly: boolean;
  /** Only keep network requests to the same origin as the page (Point 6) */
  sameOriginOnly: boolean;
}

/**
 * Complete filter configuration.
 * Every filter has a name, can be toggled, and its decisions are traceable.
 */
export interface FilterConfig {
  captureFilters: CaptureFilterConfig;
  postFilters: PostFilterConfig;
  /** Domains to allow even in same-origin mode (e.g., "api.stripe.com") */
  allowedDomains: string[];
  /** When true, log every filter decision to stderr for debugging */
  debug: boolean;
}

// ────────────────────────────────────────────────────────────────
// Recorder options — combines recording + filter configuration
// ────────────────────────────────────────────────────────────────

export interface RecorderOptions {
  port: number;                     // CDP port, default 9222
  correlationWindowMs: number;      // default 2000
  captureResourceTypes: string[];   // default ["XHR", "Fetch", "Document"]
  filters: FilterConfig;
}

/**
 * Input type for the Recorder constructor.
 * Accepts deeply partial filter config so callers can toggle individual filters
 * without specifying the entire config tree.
 */
export interface RecorderInput {
  port?: number;
  correlationWindowMs?: number;
  captureResourceTypes?: string[];
  filters?: {
    captureFilters?: Partial<CaptureFilterConfig>;
    postFilters?: Partial<PostFilterConfig>;
    allowedDomains?: string[];
    debug?: boolean;
  };
}

/** All capture-time filters ON by default */
export const DEFAULT_CAPTURE_FILTERS: CaptureFilterConfig = {
  protocols: true,
  trackerDomains: true,
  resourceTypes: true,
  fileExtensions: true,
  optionsPreflight: true,
};

/** Post-filters OFF by default — user opts in */
export const DEFAULT_POST_FILTERS: PostFilterConfig = {
  userIntentOnly: false,
  sameOriginOnly: false,
};

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  captureFilters: { ...DEFAULT_CAPTURE_FILTERS },
  postFilters: { ...DEFAULT_POST_FILTERS },
  allowedDomains: [],
  debug: false,
};

export const DEFAULT_OPTIONS: RecorderOptions = {
  port: 9222,
  correlationWindowMs: 2000,
  captureResourceTypes: ['XHR', 'Fetch', 'Document'],
  filters: { ...DEFAULT_FILTER_CONFIG },
};
