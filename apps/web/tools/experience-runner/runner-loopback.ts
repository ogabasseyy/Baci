import { createServer, request } from 'node:http';

/** Same-user bridge behind a separately configured TLS ingress. Never binds externally. */
export async function startRunnerLoopback(settings: {
  socketPath: string;
  port: number;
}) {
  if (
    !Number.isInteger(settings.port) ||
    settings.port < 0 ||
    settings.port > 65535
  )
    throw Error('INVALID_RUNNER_PORT');
  const server = createServer((incoming, outgoing) => {
    if (incoming.method !== 'POST' || incoming.url !== '/v1/execute') {
      incoming.resume();
      outgoing.writeHead(404).end();
      return;
    }
    const signature = incoming.headers['x-baci-runner-signature'];
    const upstream = request(
      {
        socketPath: settings.socketPath,
        method: 'POST',
        path: '/v1/execute',
        headers:
          typeof signature === 'string'
            ? { 'x-baci-runner-signature': signature }
            : {},
      },
      (response) => {
        const signed = response.headers['x-baci-runner-signature'];
        outgoing.writeHead(response.statusCode ?? 502, {
          'cache-control': 'no-store',
          ...(typeof signed === 'string'
            ? { 'x-baci-runner-signature': signed }
            : {}),
        });
        response.on('error', () => outgoing.destroy());
        response.pipe(outgoing);
      }
    );
    upstream.setTimeout(610000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502).end();
      else outgoing.destroy();
    });
    outgoing.on('close', () => upstream.destroy());
    incoming.on('error', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.maxConnections = 32;
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('RUNNER_LISTENER_FAILED');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
