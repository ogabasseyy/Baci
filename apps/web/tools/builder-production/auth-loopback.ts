import { createServer, request } from 'node:http';

const allowed = new Set([
  '/.well-known/openid-configuration',
  '/.well-known/oauth-authorization-server',
  '/auth',
  '/token',
  '/jwks',
  '/token/revocation',
  '/upstream/callback',
]);

/** Same-user bridge behind TLS ingress; the broker remains on a private socket. */
export async function startAuthLoopback(settings: {
  socketPath: string;
  port: number;
}) {
  if (
    !Number.isInteger(settings.port) ||
    settings.port < 0 ||
    settings.port > 65535
  )
    throw Error('INVALID_AUTH_PORT');
  const server = createServer((incoming, outgoing) => {
    let pathname: string;
    try {
      if (
        !incoming.url?.startsWith('/') ||
        incoming.url.startsWith('//') ||
        incoming.url.length > 8192
      )
        throw Error();
      pathname = new URL(incoming.url, 'https://builder-auth.usebaci.com')
        .pathname;
    } catch {
      incoming.resume();
      outgoing.writeHead(404).end();
      return;
    }
    if (
      !['GET', 'POST'].includes(incoming.method ?? '') ||
      !(
        allowed.has(pathname) ||
        /^\/(?:interaction|auth)\/[A-Za-z0-9_-]{1,256}$/.test(pathname)
      )
    ) {
      incoming.resume();
      outgoing.writeHead(404).end();
      return;
    }
    const headers: Record<string, string> = {
      host: 'builder-auth.usebaci.com',
    };
    for (const name of [
      'accept',
      'content-type',
      'content-length',
      'cookie',
      'origin',
      'user-agent',
    ]) {
      const value = incoming.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const upstream = request(
      {
        socketPath: settings.socketPath,
        path: incoming.url,
        method: incoming.method,
        headers,
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.on('error', () => outgoing.destroy());
        response.pipe(outgoing);
      }
    );
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502).end();
      else outgoing.destroy();
    });
    outgoing.on('close', () => upstream.destroy());
    incoming.on('error', () => upstream.destroy());
    incoming.pipe(upstream);
  });
  server.maxConnections = 32;
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('AUTH_LISTENER_FAILED');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
