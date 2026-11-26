// @vitest-environment node

import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';

import {
  createOwnerPreviewHttpHandler,
  send,
} from './owner-preview-http.test-support';

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
