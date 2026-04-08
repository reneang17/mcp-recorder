// ─── Test 5: Full integration test ───

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import {
  launchChrome,
  waitForChrome,
  startTestServer,
  ChromeInstance,
  TestServer,
} from './helpers/chrome-launcher';
import { Recorder } from '../src/recorder';

describe('Integration (Full Flow)', () => {
  let chrome: ChromeInstance;
  let testServer: TestServer;
  const cdpPort = 9335; // Unique port for integration tests

  beforeAll(async () => {
    testServer = await startTestServer(
      join(__dirname, '..', 'test-fixtures')
    );
    chrome = launchChrome(cdpPort);
    await waitForChrome(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (chrome) {
      chrome.kill();
    }
    if (testServer) {
      await testServer.close();
    }
  });

  it('captures and correlates a complete form fill + submit flow', async () => {
    const recorder = new Recorder({
      port: cdpPort,
      correlationWindowMs: 2000,
      captureResourceTypes: ['XHR', 'Fetch', 'Document'],
    });

    await recorder.connect();
    await recorder.startRecording();

    // Navigate to test form
    // We need direct CDP access for navigation — use a separate connection
    const CDP = await import('chrome-remote-interface');
    const nav = await CDP.default({ port: cdpPort });

    await nav.Page.enable();
    await nav.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await nav.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 800));

    // Fill in three fields using dispatched events (simulating real user)
    await nav.Runtime.evaluate({
      expression: `
        (function() {
          function setValueWithEvent(id, value) {
            var el = document.getElementById(id);
            el.focus();
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
          setValueWithEvent('username', 'john_doe');
          setValueWithEvent('email', 'john@example.com');
          setValueWithEvent('message', 'Integration test message');
        })()
      `,
    });

    await new Promise((r) => setTimeout(r, 500));

    // Click the submit button
    await nav.Runtime.evaluate({
      expression: `document.getElementById('submit-btn').click();`,
    });

    // Wait for network request to complete
    await new Promise((r) => setTimeout(r, 1500));

    await nav.close();

    // Stop recording and get correlated steps
    const steps = await recorder.stopRecording();
    await recorder.disconnect();

    // Assertions
    expect(steps.length).toBeGreaterThan(0);

    // Should have DOM events for input/change
    const domSteps = steps.filter((s) => s.domEvent !== null);
    expect(domSteps.length).toBeGreaterThan(0);

    // Should have at least one network request (the form POST or page load)
    const netSteps = steps.filter((s) => s.networkRequest !== null);
    expect(netSteps.length).toBeGreaterThan(0);

    // Find the form submit POST request
    const submitStep = steps.find(
      (s) =>
        s.networkRequest?.method === 'POST' &&
        s.networkRequest?.url.includes('/submit')
    );

    expect(submitStep).toBeDefined();
    expect(submitStep!.networkRequest!.responseStatus).toBe(200);

    // Verify the POST body contains form values
    if (submitStep!.networkRequest!.postData) {
      expect(submitStep!.networkRequest!.postData).toContain('john_doe');
      expect(submitStep!.networkRequest!.postData).toContain('john%40example.com');
    }

    // Verify step descriptions are generated
    for (const step of steps) {
      expect(step.description).toBeTruthy();
      expect(step.id).toBeTruthy();
      expect(typeof step.index).toBe('number');
    }

    // Verify steps are ordered by index
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i].index).toBe(steps[i - 1].index + 1);
    }

    console.log(`\n--- Captured ${steps.length} steps ---`);
    for (const step of steps) {
      console.log(`  [${step.index}] ${step.description}`);
    }
  }, 30000);

  it('handles recording with no user interactions gracefully', async () => {
    const recorder = new Recorder({ port: cdpPort });

    await recorder.connect();
    await recorder.startRecording();

    // Don't do anything, just wait briefly
    await new Promise((r) => setTimeout(r, 500));

    const steps = await recorder.stopRecording();
    await recorder.disconnect();

    // Should not crash and may have 0 or some steps
    expect(Array.isArray(steps)).toBe(true);
  }, 15000);
});
