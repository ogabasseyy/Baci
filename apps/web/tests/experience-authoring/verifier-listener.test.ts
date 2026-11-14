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
  const handler = vi.fn(async () => {
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
  req.destroy();
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
