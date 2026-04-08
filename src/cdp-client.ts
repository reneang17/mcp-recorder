// ─── CDP WebSocket connection wrapper ───

import CDP from 'chrome-remote-interface';

export interface CDPConnection {
  client: CDP.Client;
  Network: CDP.Client['Network'];
  Runtime: CDP.Client['Runtime'];
  Page: CDP.Client['Page'];
  Input: CDP.Client['Input'];
  DOM: CDP.Client['DOM'];
}

/**
 * Connect to a Chrome instance via CDP.
 * Finds the first available target (tab) or connects to a specific URL.
 */
export async function connectCDP(
  port: number,
  tabUrl?: string
): Promise<CDPConnection> {
  // List available targets to find an appropriate one
  const targets = await CDP.List({ port });

  let targetId: string | undefined;

  if (tabUrl) {
    const match = targets.find(
      (t) => t.type === 'page' && t.url.includes(tabUrl)
    );
    if (match) {
      targetId = match.id;
    }
  }

  if (!targetId) {
    // Pick the first page-type target
    const pageTarget = targets.find((t) => t.type === 'page');
    if (pageTarget) {
      targetId = pageTarget.id;
    }
  }

  const connectOptions: CDP.Options = { port };
  if (targetId) {
    connectOptions.target = targetId;
  }

  const client: CDP.Client = await CDP(connectOptions);
  const { Network, Runtime, Page, Input, DOM } = client;

  return { client, Network, Runtime, Page, Input, DOM };
}

/**
 * Disconnect from CDP, closing the client connection.
 */
export async function disconnectCDP(client: CDP.Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // Swallow errors on disconnect — Chrome may already be gone
  }
}
