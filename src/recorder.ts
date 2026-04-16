// ─── Main Recorder class: connect, startRecording, stopRecording ───

import {
  RecorderOptions,
  RecorderInput,
  RecordedStep,
  FilterConfig,
  DEFAULT_OPTIONS,
  DEFAULT_FILTER_CONFIG,
} from './types';
import { connectCDP, disconnectCDP, CDPConnection } from './cdp-client';
import { NetworkCapture } from './network-capture';
import { DomCapture } from './dom-capture';
import { correlate } from './correlator';
import { runPostFilters } from './post-filters';

export class Recorder {
  private options: RecorderOptions;
  private connection: CDPConnection | null = null;
  private networkCapture: NetworkCapture;
  private domCapture: DomCapture;
  private recording = false;

  constructor(options?: RecorderInput) {
    // Deep-merge filter config so individual filters can be toggled
    const filters: FilterConfig = {
      ...DEFAULT_FILTER_CONFIG,
      ...options?.filters,
      captureFilters: {
        ...DEFAULT_FILTER_CONFIG.captureFilters,
        ...options?.filters?.captureFilters,
      },
      postFilters: {
        ...DEFAULT_FILTER_CONFIG.postFilters,
        ...options?.filters?.postFilters,
      },
      allowedDomains: options?.filters?.allowedDomains ?? DEFAULT_FILTER_CONFIG.allowedDomains,
    };

    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
      filters,
    };

    this.networkCapture = new NetworkCapture(this.options);
    this.domCapture = new DomCapture();
  }

  /**
   * Connect to Chrome via CDP.
   */
  async connect(tabUrl?: string): Promise<void> {
    this.connection = await connectCDP(this.options.port, tabUrl);

    // Enable Page domain to listen for navigation events
    await this.connection.Page.enable();

    // Re-inject DOM capture script on navigations
    this.connection.Page.loadEventFired(async () => {
      if (this.recording) {
        // Wait a tick for the page to be ready
        await new Promise((r) => setTimeout(r, 100));
        await this.domCapture.reinject();
      }
    });
  }

  /**
   * Start recording DOM events and network requests.
   */
  async startRecording(tabUrl?: string): Promise<void> {
    if (!this.connection) {
      await this.connect(tabUrl);
    }

    if (!this.connection) {
      throw new Error('Failed to connect to Chrome via CDP');
    }

    this.recording = true;

    // Start both capture streams
    await this.networkCapture.start(this.connection);
    await this.domCapture.start(this.connection, this.options.filters.debug);
  }

  /**
   * Stop recording, correlate events, apply post-filters, and return the step log.
   */
  async stopRecording(): Promise<RecordedStep[]> {
    this.recording = false;

    // Stop both captures
    const [networkRequests, domEvents] = await Promise.all([
      this.networkCapture.stop(),
      this.domCapture.stop(),
    ]);

    // Correlate the two streams
    let steps = correlate(
      domEvents,
      networkRequests,
      this.options.correlationWindowMs
    );

    // Apply post-recording filters (user-intent scoring + same-origin)
    steps = runPostFilters(
      steps,
      this.options.filters.postFilters,
      this.options.filters.allowedDomains,
      this.options.filters.debug
    );

    return steps;
  }

  /**
   * Close CDP connection.
   */
  async disconnect(): Promise<void> {
    if (this.connection) {
      await disconnectCDP(this.connection.client);
      this.connection = null;
    }
  }

  /**
   * Check if currently recording.
   */
  isRecording(): boolean {
    return this.recording;
  }

  /**
   * Get the current filter configuration (useful for debugging).
   */
  getFilterConfig(): FilterConfig {
    return { ...this.options.filters };
  }
}

// Re-export types for convenience
export { RecorderOptions, RecordedStep, DomEvent, NetworkRequest, FilterConfig } from './types';
export { correlate } from './correlator';
export { runPostFilters, scoreUserIntent } from './post-filters';
export { shouldCapture, isNoiseUrl, isNoiseResourceType, runCaptureFilters } from './filters';
