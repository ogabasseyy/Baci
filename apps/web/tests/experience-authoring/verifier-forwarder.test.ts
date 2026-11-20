import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { startVerifierListener } from '../../tools/experience-verifier/listener';
import { createVerifierLoopbackForwarder } from '../../tools/experience-verifier/loopback-forwarder';

it('relays a fixed signed request only to the configured loopback verifier', async () => {
  const handler = vi.fn(async (req: Request) => {
    expect(req.headers.get('x-baci-verifier-signature')).toBe('synthetic');
    expect(req.headers.get('cookie')).toBeNull();
    expect(await req.text()).toBe('{}');
    return new Response(null, { status: 204 });
  });
  const listener = await startVerifierListener(handler, 0);
  try {
    const address = listener.server.address();
    if (!address || typeof address === 'string') throw Error('NO_LISTENER');
    const relay = createVerifierLoopbackForwarder(address.port);
    const response = await relay(
      new Request('https://verifier.baci-internal.invalid/v1/attest', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-baci-verifier-signature': 'synthetic',
          cookie: 'secret=x',
        },
        body: '{}',
      })
    );
    expect(response.status).toBe(204);
    expect(handler).toHaveBeenCalledOnce();
    expect(
      (
        await relay(
          new Request('https://evil.test/', { method: 'POST', body: '{}' })
        )
      ).status
    ).toBe(404);
  } finally {
    await listener.close();
  }
});

it('cancels the loopback request when the upstream request is aborted', async () => {
  let notify = () => {};
  const started = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const server = createServer((req) => {
    req.resume();
    notify();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  try {
    const controller = new AbortController();
    const pending = createVerifierLoopbackForwarder(address.port)(
      new Request('https://verifier.baci-internal.invalid/v1/attest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      })
    );
    await started;
    controller.abort();
    const result = await Promise.race([
      pending.then((response) => response.status),
      new Promise<number>((resolve) => setTimeout(() => resolve(0), 250)),
    ]);
    expect(result).toBe(503);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('propagates a disconnected relay to the verifier handler', async () => {
  let entered = () => {};
  let observed = () => {};
  let release = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const aborted = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const listener = await startVerifierListener(async (request) => {
    request.signal.addEventListener('abort', observed);
    entered();
    await gate;
    return new Response(null, { status: 204 });
  }, 0);
  const address = listener.server.address();
  if (!address || typeof address === 'string') throw Error('NO_LISTENER');
  try {
    const controller = new AbortController();
    const pending = createVerifierLoopbackForwarder(address.port)(
      new Request('https://verifier.baci-internal.invalid/v1/attest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        signal: controller.signal,
      })
    );
    await started;
    controller.abort();
    expect((await pending).status).toBe(503);
    expect(
      await Promise.race([
        aborted.then(() => true),
        new Promise<boolean>((resolve) =>
          setTimeout(() => resolve(false), 250)
        ),
      ])
    ).toBe(true);
  } finally {
    release();
    await listener.close();
  }
});
