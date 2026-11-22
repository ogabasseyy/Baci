import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { createPublicCartSession } from '../experience-verifier/public-cart-session';
import { runPublicCartChannel } from './public-cart-channel';
import { createPublicCartWorkerClient } from './public-cart-worker-client';
import { MAX_PUBLIC_OBSERVATION_OUTPUT_BYTES } from './public-observation-resource-limit';

it('supports route launches and commerce through the same bounded relay', async () => {
  const toHost = new PassThrough();
  const toWorker = new PassThrough();
  const origin = 'https://shop.example.com';
  const buildDigest = 'a'.repeat(64);
  const paths = Array.from(
    { length: 128 },
    (_, index) => `/pages/story-${index}`
  );
  const network = vi.fn(async ({ url }: { url: string }) => ({
    status: 200,
    body: Buffer.from('{}'),
    cookies: url.endsWith('/api/csrf')
      ? [`__Host-csrf-token=${'a'.repeat(43)}; Path=/; Secure`]
      : [],
  }));
  const cart = createPublicCartSession({
    origin,
    merchantSlug: 'synthetic',
    merchantId: '11111111-1111-4111-8111-111111111111',
    productId: '22222222-2222-4222-8222-222222222222',
    launch: { buildDigest, paths },
    network,
  });
  const run = runPublicCartChannel({
    input: toHost,
    output: toWorker,
    session: (request) =>
      new URL(request.url).pathname === '/api/storefront/experience/state'
        ? Promise.resolve({ status: 200, body: '{}' })
        : cart(request),
  });
  const worker = createPublicCartWorkerClient({
    input: toWorker,
    output: toHost,
  });
  try {
    await worker.request({ url: `${origin}/api/csrf`, method: 'GET' });
    for (const path of paths) {
      const state = new URL('/api/storefront/experience/state', origin);
      state.searchParams.set('path', path);
      await worker.request({ url: state.href, method: 'GET' });
      const launch = new URL('/api/storefront/experience/launch', origin);
      launch.searchParams.set('merchantSlug', 'synthetic');
      launch.searchParams.set('buildDigest', buildDigest);
      launch.searchParams.set('path', path);
      await worker.request({
        url: launch.href,
        method: 'POST',
        body: JSON.stringify({ buildDigest, path }),
      });
    }
    await worker.request({
      url: `${origin}/api/storefront/cart`,
      method: 'GET',
    });
    await worker.finish({ routes: paths });
    await expect(run).resolves.toEqual({ routes: paths });
    expect(network).toHaveBeenCalledTimes(paths.length + 2);
  } finally {
    toHost.destroy();
    toWorker.destroy();
    await run.catch(() => undefined);
  }
});

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
