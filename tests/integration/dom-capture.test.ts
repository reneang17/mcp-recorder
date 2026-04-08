import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, PuppeteerTestEnvironment } from '../helpers/puppeteer-harness';

describe('Real DOM Event Capture', () => {
  let env: PuppeteerTestEnvironment;
  const cdpPort = 9402; // Unique port

  beforeAll(async () => {
    env = await createTestHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('captures complex user interactions in a form', async () => {
    const { page, recorder, testServer } = env;

    await recorder.startRecording();

    await page.goto(`${testServer.url}/complex-form.html`, { waitUntil: 'load' });

    // 1. Select option (creates a change event)
    await page.select('#country', 'UK');

    // 2. Check a checkbox (creates a click event)
    await page.click('#agree');

    // 3. Select a radio button
    await page.click('#color-blue');

    // 4. Type in textarea (creates an input event)
    await page.click('#comments');
    // Clear out 'Initial'
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.type('#comments', 'New Comment');

    // 5. Hit Enter to submit (keydown event)
    await page.keyboard.press('Enter');

    // Wait for events to flow
    await new Promise(r => setTimeout(r, 500));

    const steps = await recorder.stopRecording();
    const domEvents = steps.map(s => s.domEvent).filter(e => e !== null);

    // Verify Select 'change' event
    const selectEvent = domEvents.find(e => e?.selector === '#country' && e.eventType === 'change');
    expect(selectEvent).toBeDefined();
    expect(selectEvent!.inputValue).toBe('UK');

    // Verify Checkbox 'click' event
    const checkboxEvent = domEvents.find(e => e?.selector === '#agree' && e.eventType === 'click');
    expect(checkboxEvent).toBeDefined();

    // Verify Radio 'click' event
    const radioEvent = domEvents.find(e => e?.selector === '#color-blue' && e.eventType === 'click');
    expect(radioEvent).toBeDefined();

    // Verify Textarea 'input' event (should accumulate to 'New Comment')
    const textareaEvents = domEvents.filter(e => e?.selector === '#comments' && e.eventType === 'input');
    expect(textareaEvents.length).toBeGreaterThan(0);
    const lastTextareaEvent = textareaEvents[textareaEvents.length - 1];
    expect(lastTextareaEvent!.inputValue?.trim()).toBe('New Comment');

    // Verify Enter 'keydown' event
    const enterEvent = domEvents.find(e => e?.eventType === 'keydown');
    expect(enterEvent).toBeDefined();
    expect(enterEvent!.selector).toBe('#comments');

  }, 15000);
});
