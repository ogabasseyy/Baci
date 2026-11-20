import { request } from 'node:http';
import { expect, it, vi } from 'vitest';
import { startVerifierListener } from '../../tools/experience-verifier/listener';

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
