// ─── Unit tests for Recorder class constructor and config merging ───
// These tests verify the Recorder's option handling without needing Chrome.

import { describe, it, expect } from 'vitest';
import { Recorder } from '../../src/recorder';

describe('Recorder constructor & config', () => {
  it('applies default options when none provided', () => {
    const recorder = new Recorder();
    const config = recorder.getFilterConfig();

    // All capture filters should be ON by default
    expect(config.captureFilters.protocols).toBe(true);
    expect(config.captureFilters.trackerDomains).toBe(true);
    expect(config.captureFilters.resourceTypes).toBe(true);
    expect(config.captureFilters.fileExtensions).toBe(true);
    expect(config.captureFilters.optionsPreflight).toBe(true);

    // Post-filters should be OFF by default
    expect(config.postFilters.userIntentOnly).toBe(false);
    expect(config.postFilters.sameOriginOnly).toBe(false);

    // No allowed domains
    expect(config.allowedDomains).toEqual([]);

    // Debug off
    expect(config.debug).toBe(false);
  });

  it('partially overrides captureFilters without clobbering others', () => {
    const recorder = new Recorder({
      filters: {
        captureFilters: { trackerDomains: false },
      },
    });
    const config = recorder.getFilterConfig();

    // The one we changed
    expect(config.captureFilters.trackerDomains).toBe(false);

    // All others should still be defaults (true)
    expect(config.captureFilters.protocols).toBe(true);
    expect(config.captureFilters.resourceTypes).toBe(true);
    expect(config.captureFilters.fileExtensions).toBe(true);
    expect(config.captureFilters.optionsPreflight).toBe(true);
  });

  it('partially overrides postFilters without clobbering others', () => {
    const recorder = new Recorder({
      filters: {
        postFilters: { userIntentOnly: true },
      },
    });
    const config = recorder.getFilterConfig();

    expect(config.postFilters.userIntentOnly).toBe(true);
    expect(config.postFilters.sameOriginOnly).toBe(false);  // Still default
  });

  it('passes through allowedDomains', () => {
    const recorder = new Recorder({
      filters: {
        allowedDomains: ['api.stripe.com', 'cdn.example.com'],
      },
    });
    const config = recorder.getFilterConfig();
    expect(config.allowedDomains).toEqual(['api.stripe.com', 'cdn.example.com']);
  });

  it('passes through debug flag', () => {
    const recorder = new Recorder({ filters: { debug: true } });
    expect(recorder.getFilterConfig().debug).toBe(true);
  });

  it('isRecording() is false before startRecording', () => {
    const recorder = new Recorder();
    expect(recorder.isRecording()).toBe(false);
  });

  it('accepts custom port', () => {
    // Verify it doesn't throw and the recorder is created
    const recorder = new Recorder({ port: 9333 });
    expect(recorder).toBeDefined();
    expect(recorder.isRecording()).toBe(false);
  });

  it('accepts custom correlationWindowMs', () => {
    const recorder = new Recorder({ correlationWindowMs: 5000 });
    expect(recorder).toBeDefined();
  });

  it('accepts custom captureResourceTypes', () => {
    const recorder = new Recorder({ captureResourceTypes: ['XHR', 'Fetch'] });
    expect(recorder).toBeDefined();
  });

  it('handles fully empty options', () => {
    const recorder = new Recorder({});
    expect(recorder.getFilterConfig().captureFilters.protocols).toBe(true);
  });

  it('handles empty filters object', () => {
    const recorder = new Recorder({ filters: {} });
    const config = recorder.getFilterConfig();
    expect(config.captureFilters.protocols).toBe(true);
    expect(config.postFilters.userIntentOnly).toBe(false);
  });
});
