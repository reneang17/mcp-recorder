// ─── Test 1: Network capture (integration with real Chrome) ───

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import CDP from 'chrome-remote-interface';
import {
  launchChrome,
  waitForChrome,
  startTestServer,
  ChromeInstance,
  TestServer,
} from './helpers/chrome-launcher';
import { NetworkCapture } from '../src/network-capture';
import { connectCDP, disconnectCDP, CDPConnection } from '../src/cdp-client';
import { DEFAULT_OPTIONS } from '../src/types';

describe('Network Capture (Real Chrome)', () => {
  let chrome: ChromeInstance;
  let testServer: TestServer;
  let connection: CDPConnection;
  const cdpPort = 9333; // Use non-default port to avoid conflicts

  beforeAll(async () => {
    // Start test HTTP server
    testServer = await startTestServer(
      join(__dirname, '..', 'test-fixtures')
    );

    // Launch Chrome
    chrome = launchChrome(cdpPort);
    await waitForChrome(cdpPort);

    // Connect via CDP
    connection = await connectCDP(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (connection) {
      await disconnectCDP(connection.client);
    }
    if (chrome) {
      chrome.kill();
    }
    if (testServer) {
      await testServer.close();
    }
  });

  it('captures a POST request when a form is submitted via Runtime.evaluate', async () => {
    const capture = new NetworkCapture(DEFAULT_OPTIONS);
    await capture.start(connection);

    // Navigate to test form
    await connection.Page.enable();
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();

    // Wait for page to be ready
    await new Promise((r) => setTimeout(r, 500));

    // Fill form and submit via Runtime.evaluate
    await connection.Runtime.evaluate({
      expression: `
        document.getElementById('username').value = 'testuser';
        document.getElementById('email').value = 'test@example.com';
        document.getElementById('message').value = 'Hello World';
        document.getElementById('submit-btn').click();
      `,
    });

    // Wait for the network request to complete
    await new Promise((r) => setTimeout(r, 1000));

    const requests = await capture.stop();

    // Find the POST to /submit
    const postRequest = requests.find(
      (r) =>
        r.method === 'POST' && r.url.includes('/submit')
    );

    expect(postRequest).toBeDefined();
    expect(postRequest!.method).toBe('POST');
    expect(postRequest!.url).toContain('/submit');
    expect(postRequest!.responseStatus).toBe(200);

    // Check that form data was captured
    if (postRequest!.postData) {
      expect(postRequest!.postData).toContain('username=testuser');
      expect(postRequest!.postData).toContain('email=test%40example.com');
    }
  }, 15000);

  it('filters out noise requests (images, fonts, analytics)', async () => {
    const capture = new NetworkCapture(DEFAULT_OPTIONS);
    await capture.start(connection);

    // Navigate to test page
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 500));

    const requests = await capture.stop();

    // None of the captured requests should be noise
    for (const req of requests) {
      expect(req.url).not.toMatch(/favicon\.ico/);
      expect(req.url).not.toMatch(/\.png$/);
      expect(req.url).not.toMatch(/chrome-extension/);
    }
  }, 15000);

  it('captures the document request for page navigation', async () => {
    const capture = new NetworkCapture(DEFAULT_OPTIONS);
    await capture.start(connection);

    // Navigate
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 500));

    const requests = await capture.stop();

    // Should have captured the document request
    const docRequest = requests.find(
      (r) => r.resourceType === 'Document'
    );

    expect(docRequest).toBeDefined();
    expect(docRequest!.url).toContain('test-form.html');
    expect(docRequest!.method).toBe('GET');
  }, 15000);
});
