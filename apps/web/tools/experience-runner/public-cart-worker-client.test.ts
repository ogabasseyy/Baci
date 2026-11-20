import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { runPublicCartChannel } from './public-cart-channel';
import { createPublicCartWorkerClient } from './public-cart-worker-client';

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
