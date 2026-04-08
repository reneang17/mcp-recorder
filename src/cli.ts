#!/usr/bin/env node
// ─── CLI: mcp-recorder --port 9222 --duration 30 ───

import { Recorder } from './recorder';
import { FilterConfig, DEFAULT_FILTER_CONFIG } from './types';

interface CLIArgs {
  port: number;
  duration: number | null;
  filters: Partial<FilterConfig>;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = { port: 9222, duration: null, filters: {} };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--port':
      case '-p':
        result.port = parseInt(args[++i], 10);
        break;

      case '--duration':
      case '-d':
        result.duration = parseInt(args[++i], 10);
        break;

      // ── Post-filter flags ──

      case '--user-intent':
        result.filters.postFilters = {
          ...DEFAULT_FILTER_CONFIG.postFilters,
          ...result.filters.postFilters,
          userIntentOnly: true,
        };
        break;

      case '--same-origin':
        result.filters.postFilters = {
          ...DEFAULT_FILTER_CONFIG.postFilters,
          ...result.filters.postFilters,
          sameOriginOnly: true,
        };
        break;

      case '--allow-domain':
        result.filters.allowedDomains = result.filters.allowedDomains || [];
        result.filters.allowedDomains.push(args[++i]);
        break;

      // ── Debug flag ──

      case '--debug':
        result.filters.debug = true;
        break;

      // ── Disable individual capture filters (for debugging) ──

      case '--no-filter-protocols':
        result.filters.captureFilters = {
          ...DEFAULT_FILTER_CONFIG.captureFilters,
          ...result.filters.captureFilters,
          protocols: false,
        };
        break;

      case '--no-filter-trackers':
        result.filters.captureFilters = {
          ...DEFAULT_FILTER_CONFIG.captureFilters,
          ...result.filters.captureFilters,
          trackerDomains: false,
        };
        break;

      case '--no-filter-resource-types':
        result.filters.captureFilters = {
          ...DEFAULT_FILTER_CONFIG.captureFilters,
          ...result.filters.captureFilters,
          resourceTypes: false,
        };
        break;

      case '--no-filter-extensions':
        result.filters.captureFilters = {
          ...DEFAULT_FILTER_CONFIG.captureFilters,
          ...result.filters.captureFilters,
          fileExtensions: false,
        };
        break;

      case '--no-filter-options':
        result.filters.captureFilters = {
          ...DEFAULT_FILTER_CONFIG.captureFilters,
          ...result.filters.captureFilters,
          optionsPreflight: false,
        };
        break;

      case '--no-filters':
        result.filters.captureFilters = {
          protocols: false,
          trackerDomains: false,
          resourceTypes: false,
          fileExtensions: false,
          optionsPreflight: false,
        };
        result.filters.postFilters = {
          userIntentOnly: false,
          sameOriginOnly: false,
        };
        break;

      case '--help':
      case '-h':
        console.log(`
MCP Recorder — CDP Recording Engine

Usage: mcp-recorder [options]

Options:
  --port, -p          CDP port (default: 9222)
  --duration, -d      Recording duration in seconds (default: until Ctrl+C)
  --debug             Log every filter decision to stderr

Post-recording filters:
  --user-intent       Only keep steps correlated with user actions (Point 5)
  --same-origin       Only keep same-origin network requests (Point 6)
  --allow-domain X    Allow domain X in same-origin mode (repeatable)

Disable individual capture filters (for debugging):
  --no-filter-protocols       Allow chrome-extension://, data:, blob: URLs
  --no-filter-trackers        Allow known tracker domains
  --no-filter-resource-types  Allow Image, Font, Stylesheet, etc.
  --no-filter-extensions      Allow .png, .woff2, .ico, etc.
  --no-filter-options         Allow OPTIONS preflight requests
  --no-filters                Disable ALL filters (capture raw everything)

Examples:
  # Basic recording
  mcp-recorder --port 9222

  # Clean recording for MCP tool building (recommended)
  mcp-recorder --port 9222 --user-intent

  # Strict mode: only same-origin + user-intent
  mcp-recorder --port 9222 --user-intent --same-origin

  # Same-origin with Stripe exception
  mcp-recorder --port 9222 --same-origin --allow-domain api.stripe.com

  # Debug: see every filter decision
  mcp-recorder --port 9222 --debug

  # Debug: disable a specific filter to check if it's eating real requests
  mcp-recorder --port 9222 --no-filter-trackers --debug
`);
        process.exit(0);
    }
  }

  return result;
}

async function main() {
  const args = parseArgs();

  console.error(`[mcp-recorder] Connecting to Chrome on port ${args.port}...`);

  const recorder = new Recorder({
    port: args.port,
    filters: args.filters,
  });

  // In debug mode, show active filter configuration
  if (args.filters.debug) {
    const config = recorder.getFilterConfig();
    console.error('\n[mcp-recorder] Active filter configuration:');
    console.error('  Capture-time filters:');
    for (const [name, enabled] of Object.entries(config.captureFilters)) {
      console.error(`    ${name}: ${enabled ? 'ON' : 'OFF'}`);
    }
    console.error('  Post-recording filters:');
    for (const [name, enabled] of Object.entries(config.postFilters)) {
      console.error(`    ${name}: ${enabled ? 'ON' : 'OFF'}`);
    }
    if (config.allowedDomains.length > 0) {
      console.error(`  Allowed domains: ${config.allowedDomains.join(', ')}`);
    }
    console.error('');
  }

  try {
    await recorder.connect();
    console.error('[mcp-recorder] Connected. Starting recording...');
    await recorder.startRecording();
    console.error('[mcp-recorder] Recording. Interact with Chrome now.');

    if (args.duration) {
      console.error(
        `[mcp-recorder] Will auto-stop in ${args.duration} seconds.`
      );
    } else {
      console.error('[mcp-recorder] Press Ctrl+C to stop recording.');
    }

    // Handle graceful shutdown
    const stop = async () => {
      console.error('\n[mcp-recorder] Stopping recording...');
      const steps = await recorder.stopRecording();
      await recorder.disconnect();

      // Output JSON to stdout
      console.log(JSON.stringify(steps, null, 2));

      console.error(
        `[mcp-recorder] Done. Captured ${steps.length} step(s).`
      );
      process.exit(0);
    };

    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);

    if (args.duration) {
      setTimeout(stop, args.duration * 1000);
    }

    // Keep alive
    await new Promise(() => {}); // Never resolves — waits for signal
  } catch (err) {
    console.error('[mcp-recorder] Error:', err);
    await recorder.disconnect();
    process.exit(1);
  }
}

main();
