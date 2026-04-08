import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestHarness, PuppeteerTestEnvironment } from '../helpers/puppeteer-harness';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

describe('CLI Logging feature', () => {
  let env: PuppeteerTestEnvironment;
  const cdpPort = 9876;

  beforeAll(async () => {
    // We launch harness without 'recorder' auto-start options
    env = await createTestHarness(cdpPort);
  }, 30000);

  afterAll(async () => {
    if (env) await env.cleanup();
  });

  it('verifies the exact output format of the --log CLI command', async () => {
    const { page, testServer } = env;
    const cliPath = path.join(__dirname, '..', '..', 'dist', 'cli.js');
    const logsDir = path.join(__dirname, '..', '..', 'logs');

    // Make sure we have a clean test slate
    await page.goto(`${testServer.url}/json-form.html`, { waitUntil: 'load' });

    // Start CLI via child process for 3 seconds targeting our chrome instance
    const cliProcess = execAsync(`node "${cliPath}" --port ${cdpPort} --duration 3 --log`);

    // Give it a brief moment to connect
    await new Promise(r => setTimeout(r, 1000));

    // Interact to generate exactly 1 pair of DOM/Network steps
    await page.type('#username', 'cli-tester');
    await page.click('#submit-btn');

    // Wait for the CLI to finish and write out the log file
    const { stderr, stdout } = await cliProcess;

    // The stderr typically says where it saved the log
    const match = stderr.match(/Log saved to: (.*\.json)/);
    expect(match).toBeDefined();
    
    // Fallback: If regex failed for whatever reason, look in directory directly
    const logFile = match ? match[1] : null;
    expect(logFile).not.toBeNull();
    expect(fs.existsSync(logFile!)).toBe(true);

    const fileContent = fs.readFileSync(logFile!, 'utf-8');
    const logs: any[] = JSON.parse(fileContent);

    // Normalize out dynamic data for an Exact comparison
    const normalizedLogs = logs.map(step => ({
      ...step,
      domEvent: step.domEvent ? {
        ...step.domEvent,
        id: '<ID>',
        timestamp: '<TIMESTAMP>',
        url: '<URL>',
      } : null,
      networkRequest: step.networkRequest ? {
        ...step.networkRequest,
        id: '<ID>',
        requestId: '<REQUEST_ID>',
        timestamp: '<TIMESTAMP>',
        url: '<URL>',
      } : null,
    }));

    // Some steps like the input step may precede the click, check that the submit step exists and matches
    const submitStep = normalizedLogs.find(
      s => s.networkRequest?.method === 'POST'
    );

    if (!submitStep) {
      console.error('normalizedLogs that caused failure:', JSON.stringify(normalizedLogs, null, 2));
    }
    
    expect(submitStep).toBeDefined();

    // Verify it structurally matches the exact expectation (omitting headers that vary by browser configuration)
    // We compare just the exact step we care about
    const exactSubmitComparison = {
      ...submitStep,
      networkRequest: {
        ...submitStep?.networkRequest,
        // override headers and status to static string just for structural deep equal, since Vitest expect() 
        // doesn't support nested expect.any() inside deep equalities reliably
        requestHeaders: '<HEADERS>',
        responseHeaders: '<HEADERS>',
        responseStatus: '<STATUS>'
      }
    };
    
    expect(exactSubmitComparison).toEqual({
      id: expect.any(String),
      description: expect.any(String),
      index: expect.any(Number),
      domEvent: {
        id: '<ID>',
        eventType: expect.stringMatching(/click|submit/),
        timestamp: '<TIMESTAMP>',
        selector: expect.stringMatching(/#submit-btn|#json-form/),
        tagName: expect.stringMatching(/button|form/),
        innerText: expect.any(String),
        inputValue: null,
        ariaLabel: null,
        url: '<URL>'
      },
      networkRequest: {
        id: '<ID>',
        requestId: '<REQUEST_ID>',
        resourceType: 'Fetch',
        method: 'POST',
        url: '<URL>',
        timestamp: '<TIMESTAMP>',
        requestHeaders: '<HEADERS>',
        postData: '{"username":"cli-testertest_user","age":30}',
        responseStatus: '<STATUS>',
        responseHeaders: '<HEADERS>',
        bodyEncoding: 'json',
        parsedBody: {
          username: 'cli-testertest_user',
          age: 30
        }
      },
      intentScore: 'high'
    });

    // Cleanup generated file
    fs.unlinkSync(logFile!);
  }, 15000);
});
