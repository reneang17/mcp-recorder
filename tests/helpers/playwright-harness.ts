import { chromium, Browser, Page } from 'playwright';
import { Recorder } from '../../src/recorder';
import { RecorderInput } from '../../src/types';

export interface PlaywrightTestEnvironment {
  browser: Browser;
  page: Page;
  recorder: Recorder;
  cleanup: () => Promise<void>;
}

export async function createPlaywrightHarness(
  cdpPort: number,
  recorderOptions: RecorderInput = {}
): Promise<PlaywrightTestEnvironment> {
  // Launch Chrome via Playwright with CDP port exposed
  // We use chromium.launch() with args because connectOverCDP is tricky to 
  // set up natively when we just want to launch a fresh test browser.
  const browser = await chromium.launch({
    headless: true,
    args: [
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // Give Chrome a moment to actually bind the debugging port
  await new Promise(r => setTimeout(r, 500));

  // Initialize the recorder pointing to that Chrome instance
  const recorder = new Recorder({
    port: cdpPort,
    ...recorderOptions,
  });

  await recorder.connect();

  const cleanup = async () => {
    try {
      await recorder.disconnect();
    } catch {}
    try {
      await browser.close();
    } catch {}
  };

  return { browser, page, recorder, cleanup };
}
