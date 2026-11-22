import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { runPublicCartChannel } from './public-cart-channel';
import { createPublicCartWorkerClient } from './public-cart-worker-client';
import { MAX_PUBLIC_OBSERVATION_OUTPUT_BYTES } from './public-observation-resource-limit';

it('exchanges ordered cart requests with the host and closes with an observation', async () => {
  const workerOutput = new PassThrough();
  const hostOutput = new PassThrough();
  const session = vi.fn(async () => ({ status: 200, body: '{"cart":{}}' }));
  const host = runPublicCartChannel({
    input: workerOutput,
    output: hostOutput,
    session,
  });
  const worker = createPublicCartWorkerClient({
    input: hostOutput,
    output: workerOutput,
  });
  const request = {
    url: 'https://shop.example/api/storefront/cart',
    method: 'GET' as const,
  };
  await expect(worker.request(request)).resolves.toEqual({
    status: 200,
    body: '{"cart":{}}',
  });
  await expect(worker.request(request)).resolves.toEqual({
    status: 200,
    body: '{"cart":{}}',
  });
  await worker.finish({ status: 'synthetic' });
  await expect(host).resolves.toEqual({ status: 'synthetic' });
  expect(session).toHaveBeenCalledTimes(2);
});

it('retains the same hard limit on terminal frames at both ends', async () => {
  const workerOutput = new PassThrough();
  const hostOutput = new PassThrough();
  const worker = createPublicCartWorkerClient({
    input: hostOutput,
    output: workerOutput,
  });
  const observation = 'x'.repeat(MAX_PUBLIC_OBSERVATION_OUTPUT_BYTES);
  await expect(worker.finish(observation)).rejects.toThrow(
    'PUBLIC_CART_CLIENT_OUTPUT_BUDGET'
  );
  const host = runPublicCartChannel({
    input: workerOutput,
    output: hostOutput,
    session: vi.fn(),
  });
  workerOutput.end(`${JSON.stringify({ type: 'done', observation })}\n`);
  await expect(host).rejects.toThrow('PUBLIC_CART_CHANNEL_FAILED');
  hostOutput.destroy();
});

it('rejects mismatched replies and concurrent requests', async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const worker = createPublicCartWorkerClient({ input, output });
  const request = {
    url: 'https://shop.example/api/storefront/cart',
    method: 'GET' as const,
  };
  const pending = worker.request(request);
  await expect(worker.request(request)).rejects.toThrow();
  input.end('{"type":"response","id":2,"status":200,"body":"{}"}\n');
  await expect(pending).rejects.toThrow();
});

it('returns an observation with long route metadata across the host channel', async () => {
  const workerOutput = new PassThrough();
  const hostOutput = new PassThrough();
  const session = vi.fn();
  const host = runPublicCartChannel({
    input: workerOutput,
    output: hostOutput,
    session,
  });
  const worker = createPublicCartWorkerClient({
    input: hostOutput,
    output: workerOutput,
  });
  const routes = Array.from({ length: 64 }, (_, index) => {
    const path = `/pages/${index}-${'s'.repeat(185)}`;
    return {
      path,
      canonical: `https://shop.example${path}`,
      title: '長'.repeat(500),
      status: 200,
    };
  });
  const observation = { routes };
  try {
    await worker.finish(observation);
    await expect(host).resolves.toEqual(observation);
    expect(session).not.toHaveBeenCalled();
  } finally {
    workerOutput.destroy();
    hostOutput.destroy();
    await host.catch(() => undefined);
  }
});
