import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { runPublicCartChannel } from './public-cart-channel';

function fixture() {
  const fromWorker = new PassThrough();
  const toWorker = new PassThrough();
  let replies = '';
  toWorker.on('data', (chunk) => {
    replies += chunk.toString();
  });
  const session = vi.fn(async () => ({ status: 200, body: '{"cart":{}}' }));
  return { fromWorker, toWorker, session, replies: () => replies };
}

it('relays ordered worker requests and returns the terminal observation', async () => {
  const f = fixture();
  const run = runPublicCartChannel({
    input: f.fromWorker,
    output: f.toWorker,
    session: f.session,
  });
  f.fromWorker.write(
    `${JSON.stringify({ type: 'request', id: 1, request: { url: 'https://shop.example/api/storefront/cart', method: 'GET' } })}\n`
  );
  await vi.waitFor(() => expect(f.replies()).toContain('"id":1'));
  f.fromWorker.end(
    `${JSON.stringify({ type: 'done', observation: { status: 'synthetic' } })}\n`
  );
  await expect(run).resolves.toEqual({ status: 'synthetic' });
  expect(f.session).toHaveBeenCalledOnce();
  expect(JSON.parse(f.replies())).toEqual({
    type: 'response',
    id: 1,
    status: 200,
    body: '{"cart":{}}',
  });
});

it('fails closed for out-of-order, malformed, oversized and premature terminal frames', async () => {
  for (const frame of [
    '{',
    JSON.stringify({
      type: 'request',
      id: 2,
      request: {
        url: 'https://shop.example/api/storefront/cart',
        method: 'GET',
      },
    }),
    JSON.stringify({
      type: 'request',
      id: 1,
      request: {
        url: 'https://shop.example/api/storefront/cart',
        method: 'GET',
        headers: { authorization: 'secret' },
      },
    }),
    'x'.repeat(16385),
  ]) {
    const f = fixture();
    const run = runPublicCartChannel({
      input: f.fromWorker,
      output: f.toWorker,
      session: f.session,
    });
    f.fromWorker.end(`${frame}\n`);
    await expect(run).rejects.toThrow();
    expect(f.session).not.toHaveBeenCalled();
  }
  const f = fixture();
  const run = runPublicCartChannel({
    input: f.fromWorker,
    output: f.toWorker,
    session: f.session,
  });
  f.fromWorker.end();
  await expect(run).rejects.toThrow();
});

it('does not reveal an upstream error or send a success reply if a request is rejected', async () => {
  const f = fixture();
  f.session.mockRejectedValueOnce(Error('sensitive details'));
  const run = runPublicCartChannel({
    input: f.fromWorker,
    output: f.toWorker,
    session: f.session,
  });
  f.fromWorker.end(
    `${JSON.stringify({ type: 'request', id: 1, request: { url: 'https://shop.example/api/orders', method: 'POST', body: '{}' } })}\n`
  );
  await expect(run).rejects.toThrow('PUBLIC_CART_CHANNEL_FAILED');
  expect(f.replies()).not.toContain('sensitive');
  expect(f.replies()).not.toContain('response');
});
