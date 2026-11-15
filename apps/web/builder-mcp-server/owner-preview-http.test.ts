// @vitest-environment node

import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { createOwnerAdmission } from './owner-admission';
import { createOwnerPreviewHttpHandler as createProductionOwnerPreviewHttpHandler } from './owner-preview-http';

// Transport-only unit tests inject admission; production requires signature verification.
const createOwnerPreviewHttpHandler: typeof createProductionOwnerPreviewHttpHandler =
  (bridge, options) =>
    createProductionOwnerPreviewHttpHandler(bridge, {
      admit: () => true,
      ...options,
    });

it('fails closed when a direct transport has no admission configured', async () => {
  const bridge = vi.fn(async () => Response.json({ ok: true }));
  const handler = createProductionOwnerPreviewHttpHandler(bridge);
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(401);
    expect(bridge).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects a forged signed request before dispatching bridge work', async () => {
  const bridge = vi.fn(async () => Response.json({ ok: true }));
  const handler = createOwnerPreviewHttpHandler(bridge, { admit: () => false });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(401);
    expect(bridge).not.toHaveBeenCalled();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects forged requests without consuming the authenticated work slots', async () => {
  const key = Buffer.alloc(32, 9);
  const bridge = vi.fn(async () => Response.json({ ok: true }));
  const handler = createOwnerPreviewHttpHandler(bridge, {
    admit: createOwnerAdmission(key, 'owner-preview/v1'),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const body = JSON.stringify({
    expiresAt: Date.now() + 30000,
    nonce: 'd'.repeat(64),
  });
  const signature = createHmac('sha256', key)
    .update(`owner-preview/v1\n${body}`)
    .digest('hex');
  try {
    for (let i = 0; i < 20; i++)
      expect((await send(address.port, { body })).status).toBe(401);
    expect((await send(address.port, { body, signature })).status).toBe(200);
    expect((await send(address.port, { body, signature })).status).toBe(401);
    expect(bridge).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects concurrent signed replays while the original work is still active', async () => {
  const key = Buffer.alloc(32, 8);
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const bridge = vi.fn(async () => {
    entered();
    await gate;
    return Response.json({ ok: true });
  });
  const handler = createOwnerPreviewHttpHandler(bridge, {
    admit: createOwnerAdmission(key, 'owner-preview/v1'),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const body = JSON.stringify({
    expiresAt: Date.now() + 30000,
    nonce: 'e'.repeat(64),
  });
  const signature = createHmac('sha256', key)
    .update(`owner-preview/v1\n${body}`)
    .digest('hex');
  const original = send(address.port, { body, signature });
  try {
    await started;
    const replies = await Promise.all(
      Array.from({ length: 20 }, () => send(address.port, { body, signature }))
    );
    expect(
      replies.every(
        (response) => response.status === 401 || response.status === 429
      )
    ).toBe(true);
    expect(replies.some((response) => response.status === 401)).toBe(true);
    expect(bridge).toHaveBeenCalledOnce();
    release();
    expect((await original).status).toBe(200);
  } finally {
    release();
    await original.catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('does not consume a valid nonce when all work slots are full', async () => {
  const key = Buffer.alloc(32, 6);
  let release = () => {};
  let notify = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const full = new Promise<void>((resolve) => {
    notify = resolve;
  });
  let active = 0;
  const bridge = vi.fn(async () => {
    active++;
    if (active === 16) notify();
    await gate;
    return Response.json({ ok: true });
  });
  const handler = createOwnerPreviewHttpHandler(bridge, {
    admit: createOwnerAdmission(key, 'owner-preview/v1'),
  });
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const signed = (i: number) => {
    const body = JSON.stringify({
      expiresAt: Date.now() + 30000,
      nonce: i.toString(16).padStart(64, '0'),
    });
    return {
      body,
      signature: createHmac('sha256', key)
        .update(`owner-preview/v1\n${body}`)
        .digest('hex'),
    };
  };
  const inFlight: ReturnType<typeof send>[] = [];
  const overflow = signed(16);
  try {
    for (let i = 0; i < 16; i++) {
      inFlight.push(send(address.port, signed(i)));
      await vi.waitFor(() => expect(active).toBe(i + 1));
    }
    await full;
    expect((await send(address.port, overflow)).status).toBe(429);
    release();
    await Promise.all(inFlight);
    expect((await send(address.port, overflow)).status).toBe(200);
  } finally {
    release();
    await Promise.allSettled(inFlight);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 10000);

async function send(
  port: number,
  options: {
    path?: string;
    host?: string;
    method?: string;
    body?: string;
    signature?: string | null;
    cookie?: string;
    signal?: AbortSignal;
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
        signal: options.signal,
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

it('does not expose unexpected inner bridge statuses', async () => {
  const handler = createOwnerPreviewHttpHandler(
    async () => new Response(null, { status: 302 })
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(502);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('aborts a timed-out preview bridge before returning a gateway timeout', async () => {
  let observedAbort = false;
  const handler = createOwnerPreviewHttpHandler(
    async (request) =>
      await new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          observedAbort = true;
          reject(Error('aborted'));
        });
      }),
    { timeoutMs: 25 }
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  try {
    expect((await send(address.port)).status).toBe(504);
    expect(observedAbort).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 1000);

it.each([
  'deadline',
  'disconnect',
])('retains concurrency slots after %s until work actually settles', async (trigger) => {
  const gate = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  let running = 0;
  let aborted = 0;
  const handler = createOwnerPreviewHttpHandler(
    async (req) => {
      if (++running === 16) started.resolve();
      req.signal.addEventListener('abort', () => {
        if (++aborted === 16) cancelled.resolve();
      });
      await gate.promise;
      return Response.json({ ok: true });
    },
    { timeoutMs: trigger === 'deadline' ? 300 : 30000 }
  );
  const server = createServer((req, res) => {
    void handler.handle(req, res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const client = new AbortController();
  try {
    const pending = Promise.allSettled(
      Array.from({ length: 16 }, () =>
        send(address.port, { signal: client.signal })
      )
    );
    await started.promise;
    if (trigger === 'disconnect') client.abort();
    const results = await pending;
    await cancelled.promise;
    expect(
      results.every((result) =>
        trigger === 'deadline'
          ? result.status === 'fulfilled' && result.value.status === 504
          : result.status === 'rejected'
      )
    ).toBe(true);
    expect((await send(address.port)).status).toBe(429);
    gate.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await send(address.port)).status).toBe(200);
  } finally {
    client.abort();
    gate.resolve();
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
  let incomingCount = 0;
  let rejectedResume: ReturnType<typeof vi.spyOn> | undefined;
  const handler = createOwnerPreviewHttpHandler(async () => {
    count++;
    if (count === 16) ready?.();
    await blocked;
    return Response.json({ ok: true });
  });
  const server = createServer((req, res) => {
    if (++incomingCount === 17) rejectedResume = vi.spyOn(req, 'resume');
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
    expect(rejectedResume).toHaveBeenCalled();
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
