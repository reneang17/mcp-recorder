import puppeteer, { Browser, Page } from 'puppeteer';
import { Recorder, RecorderOptions } from '../../src/recorder';
import { RecorderInput } from '../../src/types';
import { startTestServer, TestServer } from './chrome-launcher';
import { join } from 'path';

export interface PuppeteerTestEnvironment {
  browser: Browser;
  page: Page;
  recorder: Recorder;
  testServer: TestServer;
  cleanup: () => Promise<void>;
}

export async function createTestHarness(
  cdpPort: number,
  recorderOptions: RecorderInput = {}
): Promise<PuppeteerTestEnvironment> {
  // Start server to serve our local test fixtures
  const testServer = await startTestServer(
    join(__dirname, '..', '..', 'test-fixtures')
  );

  // Launch Puppeteer. We explicitly set the remote-debugging-port
  // so that the Recorder can connect to the same Chrome instance via CDP.
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--remote-debugging-port=${cdpPort}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--mute-audio',
      '--window-size=1280,720',
    ],
  });

  // Get the default page
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();

  // Create the Recorder instance pointing to the same port
  const recorder = new Recorder({
    port: cdpPort,
    ...recorderOptions,
  });

  // Automatically connect the recorder
  await recorder.connect();

  const cleanup = async () => {
    try {
      await recorder.disconnect();
    } catch {}
    try {
      await browser.close();
    } catch {}
    try {
      await testServer.close();
    } catch {}
  };

  return { browser, page, recorder, testServer, cleanup };
}
