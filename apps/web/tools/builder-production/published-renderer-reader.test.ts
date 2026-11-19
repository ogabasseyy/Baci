// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createPublishedRendererReader } from './published-renderer-reader';

vi.mock('server-only', () => ({}));

const binding = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  buildId: '22222222-2222-4222-8222-222222222222',
  buildDigest: 'a'.repeat(64),
  sourceDigest: 'b'.repeat(64),
};

it('refuses an unsafe database principal before adding a reader', async () => {
  const connect = vi.fn();
  await expect(
    createPublishedRendererReader({
      query: vi.fn(async () => ({ rows: [{ safe: false }] })),
      connect,
    } as never)
  ).rejects.toThrow('UNSAFE_RENDERER_DATABASE_SESSION');
  expect(connect).not.toHaveBeenCalled();
});

it('discards the checked-out connection if a request aborts during the exact binding read', async () => {
  const abort = new AbortController();
  const started = Promise.withResolvers<void>();
  const query = Promise.withResolvers<{ rows: Array<{ renderer: null }> }>();
  const client = {
    query: vi.fn(() => {
      started.resolve();
      return query.promise;
    }),
    release: vi.fn((destroy?: boolean) => {
      if (destroy) query.reject(Error('synthetic connection closed'));
    }),
  };
  const read = await createPublishedRendererReader({
    query: vi.fn(async () => ({ rows: [{ safe: true }] })),
    connect: vi.fn(async () => client),
  } as never);
  const pending = read('synthetic', binding, abort.signal);
  const failure = expect(pending).rejects.toThrow(
    'synthetic connection closed'
  );
  await started.promise;
  abort.abort();
  await failure;
  expect(client.release).toHaveBeenCalledExactlyOnceWith(true);
  expect(client.query).toHaveBeenCalledWith(expect.any(String), [
    'synthetic',
    binding.merchantId,
    binding.buildId,
    binding.buildDigest,
    binding.sourceDigest,
  ]);
});
