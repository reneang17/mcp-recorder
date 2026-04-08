import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, PuppeteerTestEnvironment } from '../helpers/puppeteer-harness';

describe('Selectors Priority Testing', () => {
  let env: PuppeteerTestEnvironment;
  const cdpPort = 9401; // Unique port

  beforeAll(async () => {
    env = await createTestHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('selects the best CSS selector according to priority chain', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();

    await page.goto(`${testServer.url}/selectors-test.html`, { waitUntil: 'networkidle0' });

    // Click all 5 target elements
    await page.click('#btn1'); // has data-testid, id, aria-label, name
    await page.click('#btn2'); // has id, aria-label, name
    await page.click('button[name="btn3"]'); // has aria-label, name
    await page.click('input[name="input4"]'); // has name
    await page.click('.nested-span'); // has nothing but a class

    // Give events time to flow
    await new Promise(r => setTimeout(r, 500));

    const steps = await recorder.stopRecording();
    const domEvents = steps.map(s => s.domEvent).filter(e => e !== null);

    // 1. data-testid > id
    const btn1Event = domEvents.find(e => e?.innerText === 'Button 1');
    expect(btn1Event).toBeDefined();
    expect(btn1Event!.selector).toBe('[data-testid="test-btn-1"]');

    // 2. id > aria-label
    const btn2Event = domEvents.find(e => e?.innerText === 'Button 2');
    expect(btn2Event).toBeDefined();
    expect(btn2Event!.selector).toBe('#btn2');

    // 3. aria-label > name
    const btn3Event = domEvents.find(e => e?.innerText === 'Button 3');
    expect(btn3Event).toBeDefined();
    expect(btn3Event!.selector).toBe('[aria-label="Label 3"]');

    // 4. name attribute for form fields
    const input4Event = domEvents.find(e => e?.inputValue === 'val4');
    expect(input4Event).toBeDefined();
    expect(input4Event!.selector).toBe('input[name="input4"]');

    // 5. Bare tag path fallback
    const spanEvent = domEvents.find(e => e?.innerText === 'Click me');
    expect(spanEvent).toBeDefined();
    expect(spanEvent!.selector).toMatch(/body > div > div > span/i);
  }, 15000);
});
