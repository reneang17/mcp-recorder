import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, PuppeteerTestEnvironment } from '../helpers/puppeteer-harness';

describe('Real Network Request Capture', () => {
  let env: PuppeteerTestEnvironment;
  const cdpPort = 9403; // Unique port

  beforeAll(async () => {
    env = await createTestHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('captures URL encoded POST with correct parsing', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();

    await page.goto(`${testServer.url}/complex-form.html`, { waitUntil: 'load' });
    
    // Fill and submit basic form
    await page.click('#agree');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.click('#submit-btn'),
    ]);

    const steps = await recorder.stopRecording();
    const netCalls = steps.map(s => s.networkRequest).filter(n => n !== null);

    // Look for the POST to /submit
    const submitCall = netCalls.find(n => n?.method === 'POST' && n.url.includes('/submit'));
    
    expect(submitCall).toBeDefined();
    expect(submitCall!.bodyEncoding).toBe('form-urlencoded');
    
    // Due to page.select defaults, verify parts of the parsed body
    expect(submitCall!.parsedBody).toBeDefined();
    expect(submitCall!.parsedBody!.country).toBe('CA'); // Default
    expect(submitCall!.parsedBody!.agree).toBe('yes');
    expect(submitCall!.parsedBody!.comments).toBe('Initial'); // Default
  }, 10000);

  it('captures JSON POST requests correctly parsed', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();
    await page.goto(`${testServer.url}/json-form.html`, { waitUntil: 'load' });
    
    // Submit the JSON form
    await page.click('#submit-btn');

    // Wait a brief moment for the fetch to happen
    await new Promise(r => setTimeout(r, 500));

    const steps = await recorder.stopRecording();
    const netCalls = steps.map(s => s.networkRequest).filter(n => n !== null);

    // Look for the POST to /submit
    const jsonCall = netCalls.find(n => n?.method === 'POST' && n.url.includes('/submit'));
    
    expect(jsonCall).toBeDefined();
    expect(jsonCall!.bodyEncoding).toBe('json');
    expect(jsonCall!.parsedBody).toEqual({ username: 'test_user', age: 30 });
  }, 10000);

  it('captures failed network requests with status 0', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();
    await page.goto(`${testServer.url}/error-page.html`, { waitUntil: 'load' });
    
    // Trigger network failure
    await page.click('#trigger-network-error');
    
    // Trigger 404
    await page.click('#trigger-404');

    await new Promise(r => setTimeout(r, 1000));

    const steps = await recorder.stopRecording();
    const netCalls = steps.map(s => s.networkRequest).filter(n => n !== null);

    const failCall = netCalls.find(n => n?.url.includes('54321/fail'));
    expect(failCall).toBeDefined();
    expect(failCall!.responseStatus).toBe(0); // Network error

    const notFoundCall = netCalls.find(n => n?.url.includes('/does-not-exist'));
    expect(notFoundCall).toBeDefined();
    // It's a 404 (the vitest test server returns 404 for missing paths)
    expect(notFoundCall!.responseStatus).toBe(404);
  }, 10000);
});
