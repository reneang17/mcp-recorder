import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, PuppeteerTestEnvironment } from '../helpers/puppeteer-harness';

describe('Navigation Survival via Runtime.addBinding', () => {
  let env: PuppeteerTestEnvironment;
  const cdpPort = 9400; // Unique port to avoid conflicts

  beforeAll(async () => {
    env = await createTestHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('preserves events from multiple pages across navigation', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();

    // 1. Load Page 1
    await page.goto(`${testServer.url}/multi-page/page1.html`, { waitUntil: 'load' });

    // 2. Interact with Page 1 (creates an input event)
    await page.type('#username', 'explorer');

    // 3. Navigate to Page 2 (creates a click event, triggers navigation)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'load' }),
      page.click('#nav-link'),
    ]);

    // Give the recorder script a moment to inject into the new page and bind
    await new Promise(r => setTimeout(r, 500));

    // 4. Interact with Page 2 (creates a click event)
    await page.click('#confirm-btn');
    
    // Give events time to flow through CDP
    await new Promise(r => setTimeout(r, 500));

    const steps = await recorder.stopRecording();

    // Verify events from BOTH pages are present
    const domSteps = steps.filter(s => s.domEvent !== null);
    
    // We expect:
    // - input event on #username (Page 1)
    // - click event on #nav-link (Page 1)
    // - click event on #confirm-btn (Page 2)
    // Since page.type triggers multiple input events, we want the LAST one
    const page1Inputs = domSteps.filter(s => 
      s.domEvent!.url.includes('page1.html') && 
      s.domEvent!.selector === '#username'
    );
    const page1Input = page1Inputs[page1Inputs.length - 1];

    const navClick = domSteps.find(s => 
      s.domEvent!.url.includes('page1.html') && 
      s.domEvent!.selector === '#nav-link'
    );
    const page2Click = domSteps.find(s => 
      s.domEvent!.url.includes('page2.html') && 
      s.domEvent!.selector === '#confirm-btn'
    );

    expect(page1Input).toBeDefined();
    expect(navClick).toBeDefined();
    expect(page2Click).toBeDefined();

    // Verify input value was captured
    expect(page1Input!.domEvent!.inputValue).toBe('explorer');
  }, 15000);

  it('gracefully handles multiple navigations in sequence', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();

    // Loop back and forth
    for (let i = 0; i < 3; i++) {
      await page.goto(`${testServer.url}/multi-page/page2.html`, { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 300));
      await page.click('#confirm-btn');
      
      await page.goto(`${testServer.url}/multi-page/page1.html`, { waitUntil: 'load' });
      await new Promise(r => setTimeout(r, 300));
      await page.click('#username');
    }

    const steps = await recorder.stopRecording();
    
    // Should have 3 clicks on page2 and 3 clicks on page1
    const page2Clicks = steps.filter(s => s.domEvent?.url.includes('page2.html'));
    const page1Clicks = steps.filter(s => s.domEvent?.url.includes('page1.html'));
    
    expect(page2Clicks.length).toBeGreaterThanOrEqual(3);
    expect(page1Clicks.length).toBeGreaterThanOrEqual(3);
  }, 20000);
});
