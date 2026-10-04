import { createServer, request as upstreamRequest } from 'node:http';

const writes = new Set([
  '/api/storefront/auth/send-code',
  '/api/storefront/auth/verify-code',
  '/api/storefront/auth/logout',
  '/api/storefront/customer/savings/drafts',
  '/api/storefront/customer/savings/drafts/policy',
]);

export async function startLocalSavingsBrowserGateway({ port, upstreamPort }) {
  if (
    ![port, upstreamPort].every(
      (value) => Number.isInteger(value) && value >= 1024 && value <= 65535
    ) ||
    port === upstreamPort
  )
    throw new Error('Explicit distinct local ports required');
  const origin = `http://127.0.0.1:${port}`;
  const sockets = new Set();
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' http://127.0.0.1:55431 ws://127.0.0.1:${port}`,
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  const server = createServer({ maxHeaderSize: 16384 }, (request, response) => {
    const fail = (status) => {
      if (response.headersSent) return response.destroy();
      response.writeHead(status, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify({ error: 'Local test request unavailable' }));
    };
    if (
      request.headers.host !== new URL(origin).host ||
      (request.headers.origin && request.headers.origin !== origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      Object.keys(request.headers).some(
        (key) => key === 'forwarded' || key.startsWith('x-forwarded-')
      )
    )
      return fail(403);
    const raw = request.url ?? '';
    if (
      !raw.startsWith('/') ||
      raw.startsWith('//') ||
      raw.includes('\\') ||
      (raw.split('?')[0].includes('%') &&
        !/^\/_next\/static\/[a-z0-9_./%()@-]+$/i.test(raw.split('?')[0])) ||
      /%(?!40|5b|5d)/i.test(raw.split('?')[0])
    )
      return fail(404);
    const url = new URL(raw, origin);
    const method = request.method;
    if (
      method !== 'GET' &&
      method !== 'HEAD' &&
      !(method === 'POST' && writes.has(url.pathname))
    )
      return fail(403);
    if (
      url.pathname.startsWith('/api/') &&
      ['GET', 'HEAD'].includes(method) &&
      !/^\/api\/(?:csrf|storefront\/(?:auth\/session|customer\/(?:wallet|savings\/drafts(?:\/policy)?)|products(?:\/[^/]+)?))$/.test(
        url.pathname
      )
    )
      return fail(403);
    const chunks = [];
    let length = 0;
    request.on('data', (chunk) => {
      length += chunk.length;
      if (length <= 32768) chunks.push(chunk);
    });
    request.on('end', () => {
      if (length > 32768) return fail(413);
      const headers = { ...request.headers };
      delete headers.connection;
      delete headers['accept-encoding'];
      const upstream = upstreamRequest(
        {
          hostname: '127.0.0.1',
          port: upstreamPort,
          path: raw,
          method,
          headers,
        },
        (result) => {
          if (result.headers.location) {
            const destination = new URL(result.headers.location, origin);
            if (destination.origin !== origin) {
              result.resume();
              return fail(502);
            }
          }
          const resultHeaders = { ...result.headers };
          delete resultHeaders['content-security-policy-report-only'];
          delete resultHeaders['report-to'];
          delete resultHeaders.nel;
          response.writeHead(result.statusCode ?? 502, {
            ...resultHeaders,
            'content-security-policy': csp,
            'referrer-policy': 'no-referrer',
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-store',
          });
          result.pipe(response);
        }
      );
      upstream.setTimeout(60000, () => upstream.destroy());
      upstream.on('error', () => fail(502));
      response.on('close', () => upstream.destroy());
      upstream.end(Buffer.concat(chunks));
    });
    request.on('error', () => fail(400));
  });
  server.on('upgrade', (request, socket, head) => {
    if (
      request.headers.host !== new URL(origin).host ||
      request.headers.origin !== origin ||
      request.method !== 'GET' ||
      !/^\/_next\/hmr(?:\?|$)/.test(request.url ?? '') ||
      Object.keys(request.headers).some(
        (key) => key === 'forwarded' || key.startsWith('x-forwarded-')
      )
    ) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    const upstream = upstreamRequest({
      hostname: '127.0.0.1',
      port: upstreamPort,
      path: request.url,
      method: 'GET',
      headers: request.headers,
    });
    upstream.on('upgrade', (result, upstreamSocket, upstreamHead) => {
      sockets.add(upstreamSocket);
      upstreamSocket.once('close', () => sockets.delete(upstreamSocket));
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\n${result.rawHeaders.reduce((lines, value, index, values) => (index % 2 === 0 ? `${lines}${value}: ${values[index + 1]}\r\n` : lines), '')}\r\n`
      );
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      socket.once('close', () => upstreamSocket.destroy());
      upstreamSocket.once('error', () => socket.destroy());
      socket.once('error', () => upstreamSocket.destroy());
    });
    upstream.on('response', () => socket.destroy());
    upstream.on('error', () => socket.destroy());
    upstream.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(resolve);
      }),
  };
}
