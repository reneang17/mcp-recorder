// ─── DOM event capture via CDP Runtime injection ───

import { DomEvent } from './types';
import { CDPConnection } from './cdp-client';
import fs from 'fs';

/**
 * The script injected into the target page to capture DOM events.
 * Uses Runtime.addBinding to push events to Node in real time
 * instead of polling, which prevents event loss on page navigation.
 */
function getDomCaptureScript(bindingName: string): string {
  let finderCode = '';
  try {
    const finderPath = require.resolve('@medv/finder/finder.js');
    const rawFinder = fs.readFileSync(finderPath, 'utf8');
    // Strip export tags inside the JS so it runs as a standard script block.
    // Also change `export function` to `function` to prevent syntax errors.
    finderCode = rawFinder.replace(/^export\s+/gm, '');
  } catch (err) {
    console.error('[DomCapture] Failed to load @medv/finder:', err);
  }

  return `
(function() {
  if (window.__mcp_dom_events_installed) return;
  window.__mcp_dom_events_installed = true;

  ${finderCode}

  let eventCounter = 0;

  function generateId() {
    return 'dom_' + Date.now() + '_' + (eventCounter++);
  }

  function bestSelector(el) {
    if (!el || !el.tagName) return 'unknown';

    // 1. Explicit priority attributes
    if (el.dataset && el.dataset.testid) {
      return '[data-testid="' + el.dataset.testid + '"]';
    }
    if (el.id) {
      return '#' + el.id;
    }
    if (el.getAttribute && el.getAttribute('aria-label')) {
      return '[aria-label="' + el.getAttribute('aria-label') + '"]';
    }
    if (el.name) {
      return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    }

    // 2. Use @medv/finder for robust relative/nested selector generation (replacing old fragile path logic)
    if (typeof finder !== 'undefined') {
      try {
        return finder(el, { 
          seedMinLength: 3,
          className: () => true
        });
      } catch (e) {
        // Fallback in case finder throws
      }
    }

    // 3. Absolute minimum fallback
    return el.tagName.toLowerCase();
  }

  function truncate(str, max) {
    if (!str) return '';
    str = str.trim().replace(/\\s+/g, ' ');
    return str.length > max ? str.substring(0, max) + '...' : str;
  }

  function sendEvent(event) {
    try {
      window['${bindingName}'](JSON.stringify(event));
    } catch(e) {
      // Binding might not be available yet, buffer it
      window.__mcp_dom_buffer = window.__mcp_dom_buffer || [];
      window.__mcp_dom_buffer.push(event);
    }
  }

  function flushBuffer() {
    if (window.__mcp_dom_buffer && window.__mcp_dom_buffer.length > 0) {
      var buf = window.__mcp_dom_buffer;
      window.__mcp_dom_buffer = [];
      for (var i = 0; i < buf.length; i++) {
        sendEvent(buf[i]);
      }
    }
  }

  function captureEvent(e) {
    var el = e.target;
    if (!el || !el.tagName) return;

    var tagName = el.tagName.toLowerCase();

    // Skip events on very meta elements
    if (tagName === 'html' || tagName === 'head') return;

    var event = {
      id: generateId(),
      eventType: e.type,
      timestamp: Date.now(),
      selector: bestSelector(el),
      tagName: tagName,
      innerText: truncate(el.innerText || el.textContent || '', 100),
      inputValue: null,
      ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
      url: window.location.href
    };

    // Capture input values for form elements
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      event.inputValue = el.value || null;
    }

    sendEvent(event);
  }

  document.addEventListener('click', captureEvent, true);
  document.addEventListener('input', captureEvent, true);
  document.addEventListener('change', captureEvent, true);
  document.addEventListener('submit', function(e) {
    var el = e.target;
    if (!el) return;
    var event = {
      id: generateId(),
      eventType: 'submit',
      timestamp: Date.now(),
      selector: bestSelector(el),
      tagName: (el.tagName || 'form').toLowerCase(),
      innerText: '',
      inputValue: null,
      ariaLabel: el.getAttribute ? el.getAttribute('aria-label') : null,
      url: window.location.href
    };
    sendEvent(event);
  }, true);
  document.addEventListener('keydown', function(e) {
    // Only capture Enter key presses (they often trigger navigation/submit)
    if (e.key === 'Enter') {
      captureEvent(e);
    }
  }, true);

  // Flush any buffered events
  setTimeout(flushBuffer, 100);
})();
`;
}

/**
 * Manages DOM event capture by injecting a script into the target page.
 * Uses Runtime.addBinding for real-time event delivery (no polling delay).
 */
export class DomCapture {
  private connection: CDPConnection | null = null;
  private events: DomEvent[] = [];
  private injected = false;
  private bindingName = '__mcp_pushDomEvent';
  private debug = false;

  // Keep a fallback poller for pages where binding might not work
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start capturing DOM events.
   * Sets up a binding for real-time push, then injects the capture script.
   */
  async start(connection: CDPConnection, debug: boolean = false): Promise<void> {
    this.connection = connection;
    this.events = [];
    this.injected = false;
    this.debug = debug;

    // Enable required domains
    await this.connection.Runtime.enable();
    await this.connection.Page.enable();

    // Set up binding so the page can push events to us in real time
    // This binding survives page navigations
    try {
      await this.connection.Runtime.addBinding({
        name: this.bindingName,
      });
    } catch {
      // Binding might already exist from a previous session
    }

    // Listen for binding calls
    this.connection.client.on(
      'Runtime.bindingCalled' as any,
      (params: any) => {
        if (params.name === this.bindingName) {
          try {
            const event: DomEvent = JSON.parse(params.payload);
            this.events.push(event);
          } catch (err) {
            if (this.debug) {
              console.error('[DomCapture] Failed to parse event payload:', params.payload, err);
            }
          }
        }
      }
    );

    await this.injectScript();

    // Fallback poller for edge cases
    this.startPolling();
  }

  /**
   * Inject the DOM capture script into the page.
   * Uses addScriptToEvaluateOnNewDocument so it survives page navigations.
   */
  async injectScript(): Promise<void> {
    if (!this.connection) return;

    try {
      // 1. Ensure it runs on all future navigations
      await this.connection.Page.addScriptToEvaluateOnNewDocument({
        source: getDomCaptureScript(this.bindingName),
      });

      // 2. Also inject into the CURRENT page immediately
      await this.connection.Runtime.evaluate({
        expression: getDomCaptureScript(this.bindingName),
        awaitPromise: false,
      });
      
      this.injected = true;
    } catch (err) {
      console.error('[DomCapture] Failed to inject script:', err);
    }
  }

  /**
   * Fallback poller for any buffered events that couldn't use the binding.
   */
  private startPolling(intervalMs: number = 500): void {
    this.pollingInterval = setInterval(async () => {
      await this.drainBufferedEvents();
    }, intervalMs);
  }

  /**
   * Drain any events buffered in the page (fallback for binding failures).
   */
  async drainBufferedEvents(): Promise<DomEvent[]> {
    if (!this.connection || !this.injected) return [];

    try {
      const result = await this.connection.Runtime.evaluate({
        expression: `
          (function() {
            var events = window.__mcp_dom_buffer || [];
            window.__mcp_dom_buffer = [];
            return JSON.stringify(events);
          })()
        `,
        returnByValue: true,
      });

      if (result.result && result.result.value) {
        const rawEvents: DomEvent[] = JSON.parse(result.result.value as string);
        if (rawEvents.length > 0) {
          this.events.push(...rawEvents);
        }
        return rawEvents;
      }
    } catch (err) {
      if (this.debug) {
        console.error('[DomCapture] drainBufferedEvents run failed, attempting to reinject:', err);
      }
      // Page might have navigated — re-inject
      this.injected = false;
      await this.injectScript();
    }

    return [];
  }

  /**
   * Stop capturing and return all collected events.
   */
  async stop(): Promise<DomEvent[]> {
    // Stop polling
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    // Final drain of any buffered events
    await this.drainBufferedEvents();

    return [...this.events];
  }

  /**
   * Re-inject the script (useful after page navigations).
   */
  async reinject(): Promise<void> {
    this.injected = false;
    await this.injectScript();
  }
}
