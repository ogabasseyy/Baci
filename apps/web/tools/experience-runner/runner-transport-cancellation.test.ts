import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { createRunnerExecutor } from './runner-transport';

const key = new Uint8Array(32).fill(7);
const toolchainDigest = 'a'.repeat(64);
const endpoint = 'https://runner.baci-test.net/v1/execute';

it.each([
  'headers',
  'body',
] as const)('cancels an in-flight runner HTTP response stalled at %s', async (stall) => {
  const controller = new AbortController();
  const started = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const server = createServer((req, res) => {
    req.resume();
    res.once('close', disconnected.resolve);
    if (stall === 'body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{');
    }
    started.resolve();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('fixture');
  const connected = Promise.withResolvers<void>();
  const execute = createRunnerExecutor({
    endpoint,
    key,
    toolchainDigest,
    fetch: async (url, init) => {
      const response = await fetch(
        `http://127.0.0.1:${address.port}${new URL(String(url)).pathname}`,
        init
      );
      connected.resolve();
      return response;
    },
  });
  try {
    const result = execute.withSignal('prerender', {}, controller.signal);
    const expected = expect(result).rejects.toHaveProperty(
      'name',
      'AbortError'
    );
    await started.promise;
    if (stall === 'body') await connected.promise;
    controller.abort();
    await expected;
    await disconnected.promise;
  } finally {
    controller.abort();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('waits for the first response reader cancellation to settle', async () => {
  const controller = new AbortController();
  const reading = Promise.withResolvers<void>();
  const cancelling = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const stream = new ReadableStream<Uint8Array>(
    {
      pull() {
        reading.resolve();
      },
      cancel() {
        cancelling.resolve();
        return released.promise;
      },
    },
    { highWaterMark: 0 }
  );
  const execute = createRunnerExecutor({
    endpoint,
    key,
    toolchainDigest,
    fetch: async () => new Response(stream),
  });
  let settled = false;
  const result = execute
    .withSignal('prerender', {}, controller.signal)
    .finally(() => {
      settled = true;
    });
  const expected = expect(result).rejects.toHaveProperty('name', 'AbortError');
  try {
    await reading.promise;
    controller.abort();
    await cancelling.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    released.resolve();
    await expected;
    expect(stream.locked).toBe(false);
  } finally {
    released.resolve();
  }
});
