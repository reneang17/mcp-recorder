import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPlaywrightHarness, PlaywrightTestEnvironment } from '../helpers/playwright-harness';

const SKIP_E2E = process.env.SKIP_E2E === 'true' || process.env.SKIP_E2E === '1';

describe('E2E: httpbin.org (Public API testing)', () => {
  let env: PlaywrightTestEnvironment;
  const cdpPort = 9500;

  beforeAll(async () => {
    if (SKIP_E2E) return;
    env = await createPlaywrightHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  // Skip the test block if SKIP_E2E is set
  const it_conditional = SKIP_E2E ? it.skip : it;

  it_conditional('records form navigation and POST behavior to httpbin', async () => {
    const { page, recorder } = env;

    // Start listening to the live browser
    await recorder.startRecording();

    // 1. Navigate to the httpbin form
    await page.goto('https://httpbin.org/forms/post', { waitUntil: 'load' });

    // 2. Fill out the form
    await page.fill('input[name="custname"]', 'Deepmind Tester');
    await page.fill('input[name="custtel"]', '555-1234');
    await page.fill('input[name="custemail"]', 'tester@example.com');
    await page.check('input[value="large"]');
    await page.check('input[value="bacon"]');
    await page.fill('textarea[name="comments"]', 'E2E Validation');

    // 3. Submit and wait for the resulting load
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.click('button:has-text("Submit order")'),
    ]);

    // Give data time to filter through CDP
    await new Promise(r => setTimeout(r, 1000));

    const steps = await recorder.stopRecording();

    const domEvents = steps.map(s => s.domEvent).filter(e => e !== null);
    const netRequests = steps.map(s => s.networkRequest).filter(n => n !== null);

    // Verify DOM Events
    expect(domEvents.find(e => e!.inputValue === 'Deepmind Tester')).toBeDefined();
    expect(domEvents.find(e => e!.inputValue === 'E2E Validation')).toBeDefined();
    
    // Verify Network Record
    const postCall = netRequests.find(n => n!.method === 'POST' && n!.url.includes('/post'));
    expect(postCall).toBeDefined();

    // Since httpbin uses application/x-www-form-urlencoded
    expect(postCall!.bodyEncoding).toBe('form-urlencoded');
    expect(postCall!.responseStatus).toBe(200);

    // Ensure the payload parsed correctly
    expect(postCall!.parsedBody).toBeDefined();
    expect(postCall!.parsedBody!.custname).toBe('Deepmind Tester');
    expect(postCall!.parsedBody!.comments).toBe('E2E Validation');
  }, 20000);
});
