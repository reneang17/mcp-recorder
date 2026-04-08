// ─── Test 2: DOM capture (integration with real Chrome) ───

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'path';
import {
  launchChrome,
  waitForChrome,
  startTestServer,
  ChromeInstance,
  TestServer,
} from './helpers/chrome-launcher';
import { DomCapture } from '../src/dom-capture';
import { connectCDP, disconnectCDP, CDPConnection } from '../src/cdp-client';

describe('DOM Capture (Real Chrome)', () => {
  let chrome: ChromeInstance;
  let testServer: TestServer;
  let connection: CDPConnection;
  const cdpPort = 9334; // Different port from network tests

  beforeAll(async () => {
    testServer = await startTestServer(
      join(__dirname, '..', 'test-fixtures')
    );
    chrome = launchChrome(cdpPort);
    await waitForChrome(cdpPort);
    connection = await connectCDP(cdpPort);
    await connection.Page.enable();
  }, 30000);

  afterAll(async () => {
    if (connection) {
      await disconnectCDP(connection.client);
    }
    if (chrome) {
      chrome.kill();
    }
    if (testServer) {
      await testServer.close();
    }
  });

  it('captures click events via CDP mouse dispatch', async () => {
    // Navigate to test page
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 500));

    const domCapture = new DomCapture();
    await domCapture.start(connection);

    // Wait for script injection
    await new Promise((r) => setTimeout(r, 300));

    // Click the submit button via CDP Input domain
    // First, get button coordinates via Runtime.evaluate
    const btnPos = await connection.Runtime.evaluate({
      expression: `
        (function() {
          var btn = document.getElementById('submit-btn');
          var rect = btn.getBoundingClientRect();
          return JSON.stringify({ x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
        })()
      `,
      returnByValue: true,
    });

    const pos = JSON.parse(btnPos.result.value as string);

    await connection.Input.dispatchMouseEvent({
      type: 'mousePressed',
      x: pos.x,
      y: pos.y,
      button: 'left',
      clickCount: 1,
    });
    await connection.Input.dispatchMouseEvent({
      type: 'mouseReleased',
      x: pos.x,
      y: pos.y,
      button: 'left',
      clickCount: 1,
    });

    // Wait for events to be captured
    await new Promise((r) => setTimeout(r, 500));

    const events = await domCapture.stop();

    // Should have captured at least a click event
    const clickEvents = events.filter((e) => e.eventType === 'click');
    expect(clickEvents.length).toBeGreaterThanOrEqual(1);

    // Check the click event has correct data
    const btnClick = clickEvents.find(
      (e) => e.selector.includes('submit-btn') || e.selector.includes('submit-button')
    );
    expect(btnClick).toBeDefined();
    expect(btnClick!.tagName).toBe('button');
  }, 15000);

  it('captures input events when typing into fields', async () => {
    // Navigate to test page
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 500));

    const domCapture = new DomCapture();
    await domCapture.start(connection);
    await new Promise((r) => setTimeout(r, 300));

    // Type into the username field using Runtime.evaluate to simulate input
    await connection.Runtime.evaluate({
      expression: `
        (function() {
          var input = document.getElementById('username');
          input.focus();
          input.value = 'testuser';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `,
    });

    await new Promise((r) => setTimeout(r, 500));

    const events = await domCapture.stop();

    // Should have input or change events
    const inputEvents = events.filter(
      (e) => e.eventType === 'input' || e.eventType === 'change'
    );
    expect(inputEvents.length).toBeGreaterThanOrEqual(1);

    // Check the event captured the value
    const usernameEvent = inputEvents.find(
      (e) => e.selector.includes('username')
    );
    expect(usernameEvent).toBeDefined();
    expect(usernameEvent!.inputValue).toBe('testuser');
  }, 15000);

  it('captures submit events', async () => {
    // Navigate to test page
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 500));

    const domCapture = new DomCapture();
    await domCapture.start(connection);
    await new Promise((r) => setTimeout(r, 300));

    // Trigger form submit
    await connection.Runtime.evaluate({
      expression: `
        document.getElementById('username').value = 'testuser';
        document.getElementById('email').value = 'test@example.com';
        document.getElementById('message').value = 'Hello';
        document.getElementById('test-form').dispatchEvent(new Event('submit', { bubbles: true }));
      `,
    });

    await new Promise((r) => setTimeout(r, 500));

    const events = await domCapture.stop();

    const submitEvents = events.filter((e) => e.eventType === 'submit');
    expect(submitEvents.length).toBeGreaterThanOrEqual(1);
    expect(submitEvents[0].tagName).toBe('form');
  }, 15000);

  it('generates correct selectors (data-testid priority)', async () => {
    await connection.Page.navigate({ url: `${testServer.url}/test-form.html` });
    await connection.Page.loadEventFired();
    await new Promise((r) => setTimeout(r, 500));

    const domCapture = new DomCapture();
    await domCapture.start(connection);
    await new Promise((r) => setTimeout(r, 300));

    // Trigger input on field with data-testid
    await connection.Runtime.evaluate({
      expression: `
        var input = document.querySelector('[data-testid="username-input"]');
        input.value = 'test';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      `,
    });

    await new Promise((r) => setTimeout(r, 500));

    const events = await domCapture.stop();
    const inputEvent = events.find(
      (e) => e.selector.includes('data-testid') && e.selector.includes('username-input')
    );

    expect(inputEvent).toBeDefined();
    expect(inputEvent!.selector).toBe('[data-testid="username-input"]');
  }, 15000);
});
