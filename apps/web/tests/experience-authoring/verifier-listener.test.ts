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
