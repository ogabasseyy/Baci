import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { startVerifierListener } from '../../tools/experience-verifier/listener';

it('binds only loopback and forwards a bounded fixed request to the handler', async () => {
  const handler = vi.fn(async (r: Request) => {
    expect(r.url).toBe('https://verifier.baci-internal.invalid/v1/attest');
    expect(r.headers.get('x-baci-verifier-signature')).toBe('signature');
    expect(await r.text()).toBe('{"synthetic":true}');
    return new Response(null, { status: 204 });
  });
  const listener = await startVerifierListener(handler, 0);
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    expect(address.address).toBe('127.0.0.1');
    const send = (
      options: { path?: string; host?: string; body?: string } = {}
    ) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: address.port,
            method: 'POST',
            path: options.path ?? '/v1/attest',
            headers: {
              host: options.host ?? 'verifier.baci-internal.invalid',
              'content-type': 'application/json',
              'x-baci-verifier-signature': 'signature',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          }
        );
        req.on('error', reject);
        req.end(options.body ?? '{"synthetic":true}');
      });
    expect(await send()).toBe(204);
    expect(await send({ path: '/other' })).toBe(404);
    expect(await send({ host: 'wrong.example' })).toBe(404);
    expect(await send({ body: 'x'.repeat(16385) })).toBe(413);
    expect(handler).toHaveBeenCalledOnce();
  } finally {
    await listener.close();
  }
});

it('waits for an accepted verification to finish even if its caller disconnects', async () => {
  let finish: (() => void) | undefined;
  let started: (() => void) | undefined;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  let callerSignal: AbortSignal | undefined;
  const handler = vi.fn(async (incoming: Request) => {
    callerSignal = incoming.signal;
    started?.();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return new Response(null, { status: 204 });
  });
  const listener = await startVerifierListener(handler, 0);
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  const req = request({
    host: '127.0.0.1',
    port: address.port,
    method: 'POST',
    path: '/v1/attest',
    headers: {
      host: 'verifier.baci-internal.invalid',
      'content-type': 'application/json',
    },
  });
  req.on('error', () => {});
  req.end('{}');
  await begun;
  const disconnected = Promise.withResolvers<void>();
  callerSignal?.addEventListener('abort', () => disconnected.resolve(), {
    once: true,
  });
  req.destroy();
  await disconnected.promise;
  expect(callerSignal?.aborted).toBe(true);
  let closed = false;
  const closing = listener.close().then(() => {
    closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(closed).toBe(false);
  finish?.();
  await closing;
  expect(closed).toBe(true);
});

it('only exposes build verification when the worker is installed', async () => {
  const build = vi.fn(async () => new Response(null, { status: 204 }));
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 403 }),
    0,
    build
  );
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          path: '/v1/build',
          method: 'POST',
          headers: {
            host: 'verifier.baci-internal.invalid',
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(204);
    expect(build).toHaveBeenCalledOnce();
  } finally {
    await listener.close();
  }
});

it('only exposes public verification when an explicit handler is installed', async () => {
  const publicHandler = vi.fn(async (r: Request) => {
    expect(r.url).toBe('https://verifier.baci-internal.invalid/v1/public');
    return new Response(null, { status: 204 });
  });
  for (const enabled of [false, true]) {
    const listener = await startVerifierListener(
      async () => new Response(null, { status: 403 }),
      0,
      undefined,
      undefined,
      enabled ? publicHandler : undefined
    );
    try {
      const address = listener.server.address();
      if (!address || typeof address === 'string') throw Error('NO_LISTENER');
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/v1/public',
            method: 'POST',
            headers: {
              host: 'verifier.baci-internal.invalid',
              'content-type': 'application/json',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve(res.statusCode ?? 0));
          }
        );
        req.on('error', reject);
        req.end('{}');
      });
      expect(status).toBe(enabled ? 204 : 404);
    } finally {
      await listener.close();
    }
  }
  expect(publicHandler).toHaveBeenCalledOnce();
});

it('aborts all four lanes on deadline and keeps slots until cleanup settles', async () => {
  const stopped = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let aborted = 0;
  const handler = vi.fn(async (incoming: Request) => {
    if (handler.mock.calls.length > 4)
      return new Response(null, { status: 204 });
    await new Promise<void>((resolve) =>
      incoming.signal.addEventListener('abort', () => resolve(), { once: true })
    );
    if (++aborted === 4) stopped.resolve();
    await release.promise;
    return new Response(null, { status: 204 });
  });
  const listener = await startVerifierListener(
    handler,
    0,
    handler,
    handler,
    handler,
    200
  );
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  const send = (path: string) =>
    new Promise<number>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: address.port,
          method: 'POST',
          path,
          headers: {
            host: 'verifier.baci-internal.invalid',
            'content-type': 'application/json',
          },
        },
        (res) => {
          res.resume();
          res.once('end', () => resolve(res.statusCode ?? 0));
        }
      );
      req.once('error', reject);
      req.end('{}');
    });
  const pending = ['/v1/attest', '/v1/build', '/v1/capture', '/v1/public'].map(
    send
  );
  try {
    await stopped.promise;
    expect(await Promise.all(pending)).toEqual([503, 503, 503, 503]);
    expect(await send('/v1/public')).toBe(429);
    release.resolve();
    expect(await send('/v1/public')).toBe(204);
  } finally {
    release.resolve();
    await listener.close();
  }
}, 2500);

it('aborts accepted work on shutdown and waits for its cleanup', async () => {
  const started = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const listener = await startVerifierListener(async (incoming) => {
    incoming.signal.addEventListener('abort', () => aborted.resolve(), {
      once: true,
    });
    started.resolve();
    await release.promise;
    return new Response(null, { status: 204 });
  }, 0);
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  const caller = request({
    host: '127.0.0.1',
    port: address.port,
    method: 'POST',
    path: '/v1/attest',
    headers: {
      host: 'verifier.baci-internal.invalid',
      'content-type': 'application/json',
    },
  });
  caller.on('error', () => {});
  caller.end('{}');
  try {
    await started.promise;
    let closed = false;
    const closing = listener.close().then(() => {
      closed = true;
    });
    await aborted.promise;
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    expect(closed).toBe(true);
  } finally {
    release.resolve();
    caller.destroy();
    await listener.close();
  }
});

it('drains the same capture cleanup when output budget and deadline overlap', async () => {
  const cancelling = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const cancel = vi.fn(() => {
    cancelling.resolve();
    return release.promise;
  });
  const listener = await startVerifierListener(
    async () => new Response(null, { status: 403 }),
    0,
    undefined,
    async () =>
      new Response(
        new ReadableStream({
          start: (stream) => stream.enqueue(new Uint8Array(4097)),
          cancel,
        })
      ),
    undefined,
    200
  );
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  const response = new Promise<number>((resolve, reject) => {
    const caller = request(
      {
        host: '127.0.0.1',
        port: address.port,
        method: 'POST',
        path: '/v1/capture',
        headers: {
          host: 'verifier.baci-internal.invalid',
          'content-type': 'application/json',
        },
      },
      (reply) => {
        reply.resume();
        reply.once('end', () => resolve(reply.statusCode ?? 0));
      }
    );
    caller.once('error', reject);
    caller.end('{}');
  });
  try {
    await cancelling.promise;
    expect(await response).toBe(503);
    expect(cancel).toHaveBeenCalledOnce();
    let closed = false;
    const closing = listener.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release.resolve();
    await closing;
    expect(closed).toBe(true);
  } finally {
    release.resolve();
    await listener.close();
  }
}, 2500);
