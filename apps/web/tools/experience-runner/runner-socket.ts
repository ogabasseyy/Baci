import { once } from 'node:events';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { preparePrivateSocketPath } from '../builder-auth/private-socket-path';

/** Private same-user ingress for a preflighted signed runner handler. */
export async function createRunnerSocket(settings: {
  socketPath: string;
  handler(request: Request): Promise<Response>;
}): Promise<{ close(): Promise<void> }> {
  await preparePrivateSocketPath(settings.socketPath);
  const pending = new Set<Promise<void>>();
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/execute') {
      req.resume();
      res.writeHead(404).end();
      return;
    }
    const controller = new AbortController();
    res.once('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const work = (async () => {
      const signature = req.headers['x-baci-runner-signature'];
      const request = new Request('https://runner.invalid/v1/execute', {
        method: 'POST',
        headers:
          typeof signature === 'string'
            ? { 'x-baci-runner-signature': signature }
            : {},
        body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
        duplex: 'half',
        signal: controller.signal,
      } as RequestInit & { duplex: 'half' });
      const response = await settings.handler(request);
      if (controller.signal.aborted) {
        await response.body?.cancel();
        return;
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!res.destroyed) {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(bytes);
      }
    })()
      .catch(() => {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(500).end();
        else res.destroy();
      })
      .finally(() => pending.delete(work));
    pending.add(work);
  });
  server.maxConnections = 32;
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.listen(settings.socketPath);
  await once(server, 'listening');
  try {
    await chmod(settings.socketPath, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return {
    async close() {
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      server.closeAllConnections();
      await closed;
      await Promise.allSettled(pending);
    },
  };
}
