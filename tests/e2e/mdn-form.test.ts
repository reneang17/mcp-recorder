import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPlaywrightHarness, PlaywrightTestEnvironment } from '../helpers/playwright-harness';

const SKIP_E2E = process.env.SKIP_E2E === 'true' || process.env.SKIP_E2E === '1';

describe('E2E: MDN HTML Form Example', () => {
  let env: PlaywrightTestEnvironment;
  const cdpPort = 9501;

  beforeAll(async () => {
    if (SKIP_E2E) return;
    // Turn on the same-origin post-filter to test real-world noise isolation
    env = await createPlaywrightHarness(cdpPort, {
      filters: { postFilters: { sameOriginOnly: true } }
    });
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  const it_conditional = SKIP_E2E ? it.skip : it;

  it_conditional('records interactions on a real MDN form and drops 3rd-party noise', async () => {
    const { page, recorder } = env;

    await recorder.startRecording();

    // Load MDN's live running example of a form
    await page.goto('https://mdn.github.io/learning-area/html/forms/your-first-HTML-form/first-form-styled.html', { waitUntil: 'load' });

    // Fill form
    await page.fill('#name', 'Mister Anderson');
    await page.fill('#mail', 'neo@matrix.com');
    await page.fill('#msg', 'Follow the white rabbit.');

    // Submit
    await Promise.all([
      // They just submit to nothing in the demo, but it fires the events
      page.click('button[type="submit"]'),
    ]);

    await new Promise(r => setTimeout(r, 1000));

    const steps = await recorder.stopRecording();
    
    // Test the network requests. Since sameOriginOnly is ON, we shouldn't see
    // analytics pings or third-party fonts (like Google Fonts) in the output.
    const netRequests = steps.map(s => s.networkRequest).filter(n => n !== null);
    for (const req of netRequests) {
      if (req) {
        // Assert every single kept network request is from mdn.github.io
        expect(req.url.startsWith('https://mdn.github.io')).toBe(true);
      }
    }

    // Verify DOM Events
    const domEvents = steps.map(s => s.domEvent).filter(e => e !== null);
    
    const nameInput = domEvents.find(e => e!.selector === '#name');
    expect(nameInput).toBeDefined();
    expect(nameInput!.inputValue).toBe('Mister Anderson');

    const msgInput = domEvents.find(e => e!.selector === '#msg');
    expect(msgInput).toBeDefined();
    expect(msgInput!.inputValue).toBe('Follow the white rabbit.');

    const submitEvent = domEvents.find(e => e!.eventType === 'submit' || (e!.eventType === 'click' && e!.innerText === 'Send your message'));
    expect(submitEvent).toBeDefined();

  }, 20000);
});
