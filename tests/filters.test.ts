// ─── Tests for capture-time filters ───

import { describe, it, expect } from 'vitest';
import {
  isNoiseUrl,
  isNoiseResourceType,
  shouldCapture,
  filterProtocols,
  filterTrackerDomains,
  filterResourceTypes,
  filterFileExtensions,
  filterOptionsPreflight,
  runCaptureFilters,
} from '../src/filters';
import { DEFAULT_CAPTURE_FILTERS } from '../src/types';

// ────────────────────────────────────────────────────────────────
// Legacy API tests (backward compatibility)
// ────────────────────────────────────────────────────────────────

describe('Noise Filtering (legacy API)', () => {
  describe('isNoiseUrl', () => {
    it('filters chrome-extension:// URLs', () => {
      expect(isNoiseUrl('chrome-extension://abc123/popup.html')).toBe(true);
    });

    it('filters data: URLs', () => {
      expect(isNoiseUrl('data:text/html,<html></html>')).toBe(true);
    });

    it('filters blob: URLs', () => {
      expect(isNoiseUrl('blob:http://localhost:3000/abc')).toBe(true);
    });

    it('filters Google Analytics', () => {
      expect(isNoiseUrl('https://www.google-analytics.com/analytics.js')).toBe(true);
      expect(isNoiseUrl('https://analytics.google.com/collect?v=1')).toBe(true);
    });

    it('filters Google Tag Manager', () => {
      expect(isNoiseUrl('https://www.googletagmanager.com/gtag/js?id=UA-123')).toBe(true);
    });

    it('filters Facebook tracking', () => {
      expect(isNoiseUrl('https://connect.facebook.net/en_US/fbevents.js')).toBe(true);
    });

    it('filters Sentry', () => {
      expect(isNoiseUrl('https://o123.ingest.sentry.io/api/456/envelope/')).toBe(true);
    });

    it('filters Hotjar', () => {
      expect(isNoiseUrl('https://script.hotjar.com/modules.js')).toBe(true);
    });

    it('filters image URLs', () => {
      expect(isNoiseUrl('https://example.com/images/logo.png')).toBe(true);
      expect(isNoiseUrl('https://cdn.example.com/hero.jpg')).toBe(true);
      expect(isNoiseUrl('https://example.com/icon.svg')).toBe(true);
      expect(isNoiseUrl('https://example.com/photo.webp')).toBe(true);
    });

    it('filters font URLs', () => {
      expect(isNoiseUrl('https://fonts.example.com/roboto.woff2')).toBe(true);
      expect(isNoiseUrl('https://example.com/font.ttf')).toBe(true);
    });

    it('filters favicon', () => {
      expect(isNoiseUrl('https://example.com/favicon.ico')).toBe(true);
    });

    it('allows normal API URLs', () => {
      expect(isNoiseUrl('https://api.example.com/users')).toBe(false);
      expect(isNoiseUrl('https://example.com/api/v1/data')).toBe(false);
    });

    it('allows localhost URLs', () => {
      expect(isNoiseUrl('http://localhost:3000/api/submit')).toBe(false);
    });

    it('allows normal page URLs', () => {
      expect(isNoiseUrl('https://example.com/login')).toBe(false);
      expect(isNoiseUrl('https://example.com/dashboard')).toBe(false);
    });
  });

  describe('isNoiseResourceType', () => {
    it('filters Image resource type', () => {
      expect(isNoiseResourceType('Image')).toBe(true);
    });

    it('filters Font resource type', () => {
      expect(isNoiseResourceType('Font')).toBe(true);
    });

    it('filters Stylesheet resource type', () => {
      expect(isNoiseResourceType('Stylesheet')).toBe(true);
    });

    it('filters Media resource type', () => {
      expect(isNoiseResourceType('Media')).toBe(true);
    });

    it('allows XHR resource type', () => {
      expect(isNoiseResourceType('XHR')).toBe(false);
    });

    it('allows Fetch resource type', () => {
      expect(isNoiseResourceType('Fetch')).toBe(false);
    });

    it('allows Document resource type', () => {
      expect(isNoiseResourceType('Document')).toBe(false);
    });
  });

  describe('shouldCapture', () => {
    const allowedTypes = ['XHR', 'Fetch', 'Document'];

    it('captures normal XHR requests', () => {
      expect(shouldCapture('https://api.example.com/data', 'XHR', allowedTypes)).toBe(true);
    });

    it('captures Fetch requests', () => {
      expect(shouldCapture('https://api.example.com/data', 'Fetch', allowedTypes)).toBe(true);
    });

    it('captures Document requests', () => {
      expect(shouldCapture('https://example.com/page', 'Document', allowedTypes)).toBe(true);
    });

    it('rejects noise URLs even with allowed resource type', () => {
      expect(
        shouldCapture('https://www.google-analytics.com/collect', 'XHR', allowedTypes)
      ).toBe(false);
    });

    it('rejects non-allowed resource types even with clean URLs', () => {
      expect(shouldCapture('https://example.com/style.css', 'Stylesheet', allowedTypes)).toBe(
        false
      );
    });

    it('rejects noise resource types', () => {
      expect(shouldCapture('https://example.com/logo', 'Image', allowedTypes)).toBe(false);
    });

    it('allows any resource type when allowedTypes is empty', () => {
      expect(shouldCapture('https://api.example.com/data', 'Script', [])).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// Individual filter function tests
// ────────────────────────────────────────────────────────────────

describe('Individual Capture Filters', () => {
  describe('filterProtocols', () => {
    it('rejects chrome-extension:// with reason', () => {
      const result = filterProtocols('chrome-extension://abc/popup.html');
      expect(result.keep).toBe(false);
      expect(result.rejectedBy).toBe('protocols');
      expect(result.reason).toContain('chrome-extension:');
    });

    it('rejects data: with reason', () => {
      const result = filterProtocols('data:text/html,test');
      expect(result.keep).toBe(false);
      expect(result.rejectedBy).toBe('protocols');
    });

    it('passes https:// URLs', () => {
      const result = filterProtocols('https://example.com/api');
      expect(result.keep).toBe(true);
      expect(result.rejectedBy).toBeNull();
    });
  });

  describe('filterTrackerDomains', () => {
    it('rejects google-analytics.com with reason', () => {
      const result = filterTrackerDomains('https://www.google-analytics.com/analytics.js');
      expect(result.keep).toBe(false);
      expect(result.rejectedBy).toBe('tracker-domains');
      expect(result.reason).toContain('google-analytics.com');
    });

    it('rejects subdomains of blocked domains', () => {
      const result = filterTrackerDomains('https://sub.hotjar.com/script.js');
      expect(result.keep).toBe(false);
    });

    it('passes normal domains', () => {
      const result = filterTrackerDomains('https://api.example.com/data');
      expect(result.keep).toBe(true);
    });
  });

  describe('filterResourceTypes', () => {
    it('rejects Image with reason', () => {
      const result = filterResourceTypes('Image', []);
      expect(result.keep).toBe(false);
      expect(result.rejectedBy).toBe('resource-types');
    });

    it('rejects types not in allowed list', () => {
      const result = filterResourceTypes('Script', ['XHR', 'Fetch']);
      expect(result.keep).toBe(false);
      expect(result.reason).toContain('not in allowed list');
    });

    it('passes XHR', () => {
      const result = filterResourceTypes('XHR', ['XHR', 'Fetch', 'Document']);
      expect(result.keep).toBe(true);
    });
  });

  describe('filterFileExtensions', () => {
    it('rejects .png with reason', () => {
      const result = filterFileExtensions('https://example.com/logo.png');
      expect(result.keep).toBe(false);
      expect(result.rejectedBy).toBe('file-extensions');
    });

    it('rejects .woff2', () => {
      const result = filterFileExtensions('https://fonts.com/roboto.woff2');
      expect(result.keep).toBe(false);
    });

    it('passes API URLs', () => {
      const result = filterFileExtensions('https://example.com/api/data');
      expect(result.keep).toBe(true);
    });
  });

  describe('filterOptionsPreflight (Point 3)', () => {
    it('rejects OPTIONS requests with reason', () => {
      const result = filterOptionsPreflight('OPTIONS');
      expect(result.keep).toBe(false);
      expect(result.rejectedBy).toBe('options-preflight');
      expect(result.reason).toContain('CORS preflight');
    });

    it('passes GET requests', () => {
      const result = filterOptionsPreflight('GET');
      expect(result.keep).toBe(true);
    });

    it('passes POST requests', () => {
      const result = filterOptionsPreflight('POST');
      expect(result.keep).toBe(true);
    });
  });
});

// ────────────────────────────────────────────────────────────────
// Filter pipeline tests
// ────────────────────────────────────────────────────────────────

describe('Capture Filter Pipeline (runCaptureFilters)', () => {
  const allowedTypes = ['XHR', 'Fetch', 'Document'];

  it('passes a clean XHR request through all filters', () => {
    const result = runCaptureFilters(
      'https://api.example.com/data',
      'GET',
      'XHR',
      allowedTypes,
      DEFAULT_CAPTURE_FILTERS
    );
    expect(result.keep).toBe(true);
    expect(result.rejectedBy).toBeNull();
  });

  it('rejects OPTIONS even with clean URL', () => {
    const result = runCaptureFilters(
      'https://api.example.com/data',
      'OPTIONS',
      'XHR',
      allowedTypes,
      DEFAULT_CAPTURE_FILTERS
    );
    expect(result.keep).toBe(false);
    expect(result.rejectedBy).toBe('options-preflight');
  });

  it('rejects tracker domains', () => {
    const result = runCaptureFilters(
      'https://www.google-analytics.com/collect',
      'GET',
      'XHR',
      allowedTypes,
      DEFAULT_CAPTURE_FILTERS
    );
    expect(result.keep).toBe(false);
    expect(result.rejectedBy).toBe('tracker-domains');
  });

  it('skips disabled filters', () => {
    const config = { ...DEFAULT_CAPTURE_FILTERS, trackerDomains: false };
    const result = runCaptureFilters(
      'https://www.google-analytics.com/collect',
      'GET',
      'XHR',
      allowedTypes,
      config
    );
    // With tracker filter disabled, this passes (it's a valid URL + XHR)
    expect(result.keep).toBe(true);
  });

  it('respects individual filter toggles', () => {
    // Disable only OPTIONS filter
    const config = { ...DEFAULT_CAPTURE_FILTERS, optionsPreflight: false };
    const result = runCaptureFilters(
      'https://api.example.com/data',
      'OPTIONS',
      'XHR',
      allowedTypes,
      config
    );
    // OPTIONS now passes through
    expect(result.keep).toBe(true);
  });

  it('returns the FIRST filter that rejects (short-circuit)', () => {
    // This URL would fail both protocols AND tracker-domains filters
    // But protocols runs first
    const result = runCaptureFilters(
      'chrome-extension://tracking/analytics.js',
      'GET',
      'XHR',
      allowedTypes,
      DEFAULT_CAPTURE_FILTERS
    );
    expect(result.keep).toBe(false);
    expect(result.rejectedBy).toBe('protocols');
  });
});
