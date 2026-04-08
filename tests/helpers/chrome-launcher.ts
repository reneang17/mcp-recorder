// ─── Chrome launcher helper for tests ───

import { execSync, ChildProcess, spawn } from 'child_process';
import { createServer, Server, IncomingMessage, ServerResponse } from 'http';
import { readFileSync } from 'fs';
import { join } from 'path';

const CHROME_PATHS = [
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  // Linux
  'google-chrome',
  'google-chrome-stable',
  'chromium-browser',
  'chromium',
];

/**
 * Find installed Chrome/Chromium binary.
 */
function findChrome(): string {
  for (const chromePath of CHROME_PATHS) {
    try {
      // Check if the path exists (for absolute paths) or is in PATH
      if (chromePath.startsWith('/')) {
        execSync(`test -f "${chromePath}"`, { stdio: 'ignore' });
        return chromePath;
      } else {
        execSync(`which ${chromePath}`, { stdio: 'ignore' });
        return chromePath;
      }
    } catch {
      continue;
    }
  }
  throw new Error(
    'Chrome not found. Install Google Chrome or Chromium and try again.'
  );
}

export interface ChromeInstance {
  process: ChildProcess;
  port: number;
  kill: () => void;
}

/**
 * Launch Chrome with remote debugging enabled.
 */
export function launchChrome(port: number = 9222): ChromeInstance {
  const chromePath = findChrome();
  const userDataDir = `/tmp/mcp-recorder-test-${port}-${Date.now()}`;

  const chromeProcess = spawn(
    chromePath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--mute-audio',
      '--window-size=1280,720',
      'about:blank',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    }
  );

  return {
    process: chromeProcess,
    port,
    kill: () => {
      try {
        chromeProcess.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
      // Clean up user data dir
      try {
        execSync(`rm -rf "${userDataDir}"`, { stdio: 'ignore' });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Wait for Chrome's CDP endpoint to be ready.
 */
export async function waitForChrome(
  port: number,
  timeoutMs: number = 15000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(`Chrome did not start on port ${port} within ${timeoutMs}ms`);
}

export interface TestServer {
  server: Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}

/**
 * Start a simple HTTP server to serve test fixtures.
 */
export function startTestServer(fixturesDir: string): Promise<TestServer> {
  return new Promise((resolve, reject) => {
    const server = createServer(
      (req: IncomingMessage, res: ServerResponse) => {
        const urlPath = req.url || '/';

        if (req.method === 'POST') {
          // Accept POSTs and echo back
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ received: body }));
          });
          return;
        }

        // Serve test-form.html for root or /test-form.html
        const fileName =
          urlPath === '/' ? 'test-form.html' : urlPath.slice(1);
        try {
          const filePath = join(fixturesDir, fileName);
          const content = readFileSync(filePath, 'utf-8');
          const ext = fileName.split('.').pop();
          const mimeTypes: Record<string, string> = {
            html: 'text/html',
            js: 'text/javascript',
            css: 'text/css',
            json: 'application/json',
          };
          res.writeHead(200, {
            'Content-Type': mimeTypes[ext || 'html'] || 'text/plain',
          });
          res.end(content);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
        }
      }
    );

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (typeof addr === 'object' && addr) {
        const testServer: TestServer = {
          server,
          port: addr.port,
          url: `http://127.0.0.1:${addr.port}`,
          close: () =>
            new Promise<void>((res) => server.close(() => res())),
        };
        resolve(testServer);
      } else {
        reject(new Error('Failed to get server address'));
      }
    });

    server.on('error', reject);
  });
}
