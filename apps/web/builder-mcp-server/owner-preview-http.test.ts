// @vitest-environment node
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createOwnerPreviewHttpHandler } from './owner-preview-http';

async function send(
  port: number,
  options: {
    path?: string;
    host?: string;
    method?: string;
    body?: string;
    signature?: string | null;
    cookie?: string;
  } = {}
) {
  return await new Promise<{
    status: number;
    body: string;
    headers: import('node:http').IncomingHttpHeaders;
  }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: options.path ?? '/internal/owner/preview',
        method: options.method ?? 'POST',
        headers: {
          host: options.host ?? 'mcp.usebaci.com',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(options.body ?? '{}'),
          ...(options.signature === null
            ? {}
            : {
                'x-baci-owner-signature': options.signature ?? 'a'.repeat(64),
              }),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers })
        );
      }
    );
    req.on('error', (error) =>
      reject(
        new Error(
          `request ${options.method ?? 'POST'} ${options.path ?? '/'} ${options.body?.length ?? 0}: ${error.message}`
        )
      )
    );
    req.end(options.body ?? '{}');
  });
}
it('forwards only the fixed owner preview path, signed body and no browser cookies', async () => {
  const bridge = vi.fn(async (r: Request) => {
    expect(r.url).toBe('https://mcp.usebaci.com/internal/owner/preview');
    expect(r.headers.get('x-baci-owner-signature')).toBe('a'.repeat(64));
    expect(r.headers.get('cookie')).toBeNull();
    expect(await r.text()).toBe('{}');
    return Response.json(
      { ok: true },
      { headers: { 'cache-control': 'private, no-store' } }
    );
  });
  const handler = createOwnerPreviewHttpHandler(bridge);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port, { cookie: 'private=1' })).status).toBe(
      200
    );
    expect((await send(address.port, { host: 'evil.test' })).status).toBe(404);
    expect(
      (await send(address.port, { path: '/internal/owner/preview?x=1' })).status
    ).toBe(404);
    expect((await send(address.port, { method: 'GET' })).status).toBe(404);
    expect((await send(address.port, { body: 'x'.repeat(17000) })).status).toBe(
      413
    );
    expect(bridge).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects missing and malformed signatures before dispatch and reports bridge failures', async () => {
  const bridge = vi.fn(async () => {
    throw Error('bridge unavailable');
  });
  const handler = createOwnerPreviewHttpHandler(bridge);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port, { signature: null })).status).toBe(401);
    expect((await send(address.port, { signature: 'invalid' })).status).toBe(
      401
    );
    expect(bridge).not.toHaveBeenCalled();
    expect((await send(address.port)).status).toBe(502);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not forward an oversized bridge response', async () => {
  const handler = createOwnerPreviewHttpHandler(
    async () => new Response('x'.repeat(300000))
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const response = await send(address.port);
    expect(response.status).toBe(502);
    expect(response.body).toBe('{}');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('bounds concurrent admitted owner requests', async () => {
  let release: (() => void) | undefined;
  let ready: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let count = 0;
  const handler = createOwnerPreviewHttpHandler(async () => {
    count++;
    if (count === 16) ready?.();
    await blocked;
    return Response.json({ ok: true });
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    const pending = Array.from({ length: 16 }, () => send(address.port));
    await started;
    expect((await send(address.port)).status).toBe(429);
    release?.();
    expect(
      (await Promise.all(pending)).every((result) => result.status === 200)
    ).toBe(true);
  } finally {
    release?.();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
