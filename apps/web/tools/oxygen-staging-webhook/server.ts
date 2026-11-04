import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import {
  type AcceptOxygenWebhook,
  type OxygenCallbackConfiguration,
  receiveOxygenWebhook,
} from '../../src/lib/payments/oxygen/webhook-receiver';

export function createStagingWebhookServer(
  config: OxygenCallbackConfiguration,
  accept: AcceptOxygenWebhook
) {
  const server = createServer(async (incoming, outgoing) => {
    outgoing.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      if (incoming.method === 'GET' && url.pathname === '/health') {
        outgoing.setHeader('Content-Type', 'application/json');
        outgoing.end(JSON.stringify({ ready: true, environment: 'staging' }));
        return;
      }
      if (url.pathname !== '/oxygen-staging-hook' || url.search) {
        outgoing.writeHead(404);
        outgoing.end();
        return;
      }
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers.set(name, value);
      }
      const method = incoming.method ?? 'GET';
      const init: RequestInit & { duplex?: 'half' } = { method, headers };
      if (method !== 'GET' && method !== 'HEAD') {
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
      }
      const result = await receiveOxygenWebhook(
        new Request(url, init),
        config,
        accept
      );
      outgoing.writeHead(result.status, { 'Content-Type': 'application/json' });
      outgoing.end(await result.text());
    } catch {
      outgoing.writeHead(503);
      outgoing.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 32;
  return server;
}
