import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, PuppeteerTestEnvironment } from '../helpers/puppeteer-harness';

describe('Recorder Lifecycle & Correlator Integration', () => {
  let env: PuppeteerTestEnvironment;
  const cdpPort = 9404; // Unique port

  beforeAll(async () => {
    env = await createTestHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('orchestrates full connect -> start -> interact -> stop', async () => {
    const { page, recorder, testServer } = env;

    // Check pre-state
    expect(recorder.isRecording()).toBe(false);

    // Start
    await recorder.startRecording();
    expect(recorder.isRecording()).toBe(true);

    // Provide rapid interactions
    await page.goto(`${testServer.url}/rapid-events.html`, { waitUntil: 'load' });
    await page.click('#start-rapid');

    // Small wait for events internally
    await new Promise(r => setTimeout(r, 500));

    // Stop
    const steps = await recorder.stopRecording();
    expect(recorder.isRecording()).toBe(false);

    // Because the script dispatches 20 automated button clicks from the loop, 
    // plus the 1 click on the start-rapid button itself, we expect >= 21 clicks
    expect(steps.length).toBeGreaterThanOrEqual(21);
    
    // Check indexing
    for (let i = 0; i < steps.length; i++) {
      expect(steps[i].index).toBe(i);
    }
  }, 15000);

  it('successfully correlates full step (DOM + Network)', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();

    await page.goto(`${testServer.url}/json-form.html`, { waitUntil: 'load' });
    
    // Typing fields 
    await page.type('#username', 'testrunner');
    await page.click('#submit-btn');

    await new Promise(r => setTimeout(r, 600));

    const steps = await recorder.stopRecording();

    // Look for the paired step: The click on submit-btn paired with POST to /submit
    const pairedStep = steps.find(s => 
      s.domEvent !== null &&
      s.networkRequest !== null &&
      s.networkRequest.method === 'POST' &&
      s.networkRequest.url.includes('/submit')
    );

    expect(pairedStep).toBeDefined();
    
    // The post-filter system automatically scores correlated steps as 'high'
    // even if it doesn't filter out the others
    expect(pairedStep!.intentScore).toBe('high');
  }, 15000);

  it('runs post-filters dropping uncorrelated background requests', async () => {
    // Modify recorder options for this test to enable post filter
    const localEnv = await createTestHarness(9405, {
      filters: { postFilters: { userIntentOnly: true, sameOriginOnly: false } }
    });
    
    try {
      const { page, recorder, testServer } = localEnv;
      
      await recorder.startRecording();

      await page.goto(`${testServer.url}/error-page.html`, { waitUntil: 'load' });

      // We explicitly DO NOT trigger any DOM events, but evaluate JS directly
      // to make a network request (simulating background ajax).
      await page.evaluate(() => {
        fetch('/api/does-not-exist');
      });

      await new Promise(r => setTimeout(r, 600));

      const steps = await recorder.stopRecording();
      
      // Because userIntentOnly = true, and no DOM event was near it,
      // the orphan network request should have been filtered out.
      // So steps should only include the Document request.
      const fetchSteps = steps.filter(s => s.networkRequest?.url.includes('/api/does-not-exist'));
      expect(fetchSteps.length).toBe(0);

    } finally {
      await localEnv.cleanup();
    }
  }, 15000);
});
