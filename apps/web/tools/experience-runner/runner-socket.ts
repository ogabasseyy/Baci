import { once } from 'node:events';
import { chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { assertPrivateDirectory } from '../builder-auth/private-directory';

/** Private same-user ingress for a preflighted signed runner handler. */
export async function createRunnerSocket(settings: {
  socketPath: string;
  handler(request: Request): Promise<Response>;
}): Promise<{ close(): Promise<void> }> {
  if (!isAbsolute(settings.socketPath))
    throw Error('UNTRUSTED_SOCKET_DIRECTORY');
  await assertPrivateDirectory(dirname(settings.socketPath));
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/execute') {
      req.resume();
      res.writeHead(404).end();
      return;
    }
    void (async () => {
      const signature = req.headers['x-baci-runner-signature'];
      const request = new Request('https://runner.invalid/v1/execute', {
        method: 'POST',
        headers:
          typeof signature === 'string'
            ? { 'x-baci-runner-signature': signature }
            : {},
        body: Readable.toWeb(req) as ReadableStream<Uint8Array>,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });
      const response = await settings.handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.destroy();
    });
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
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    },
  };
}
