import { createServer } from 'node:http';
import { connect, Socket } from 'node:net';

/** Fixed CONNECT destinations only; DNS is never consulted and no external host
 * or caller-selected loopback service can be reached through a request. */
export async function startPerformanceTunnel(
  targets: ReadonlyMap<string, number>
) {
  if (
    targets.size !== 2 ||
    [...targets].some(
      ([host, port]) =>
        !/^[a-z0-9.-]+:\d{1,5}$/.test(host) ||
        !Number.isInteger(port) ||
        port < 1024 ||
        port > 65535
    )
  )
    throw Error('INVALID_TLS_HARNESS_TARGET');
  const fixed = new Map(targets);
  const sockets = new Set<Socket>();
  let blocked = 0;
  const server = createServer((_req, res) => {
    blocked++;
    res.writeHead(403, { Connection: 'close' }).end();
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('connect', (request, client, head) => {
    if (!(client instanceof Socket)) {
      client.destroy();
      return;
    }
    const port = fixed.get(request.url ?? '');
    if (!port || sockets.size >= 64 || head.length > 65536) {
      blocked++;
      client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const upstream = connect(port, '127.0.0.1');
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.setTimeout(20000, () => socket.destroy());
      socket.once('close', () => sockets.delete(socket));
    }
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.once('close', () => upstream.destroy());
    upstream.once('close', () => client.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('HARNESS_LISTENER_UNAVAILABLE');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    blocked: () => blocked,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
