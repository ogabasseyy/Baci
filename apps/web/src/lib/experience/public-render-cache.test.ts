import { expect, it, vi } from 'vitest';
import { createPublicRenderCache } from './public-render-cache';

it('reuses completed and in-flight public fragments but isolates changed bootstrap keys', async () => {
  const cache = createPublicRenderCache();
  let resolve: (html: string) => void = () => {};
  const render = vi.fn(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      })
  );
  const first = cache.read('exact-public-binding-250', render);
  const second = cache.read('exact-public-binding-250', render);
  resolve('<h1>250</h1>');
  expect(await first).toBe('<h1>250</h1>');
  expect(await second).toBe('<h1>250</h1>');
  expect(await cache.read('exact-public-binding-250', render)).toBe(
    '<h1>250</h1>'
  );
  expect(render).toHaveBeenCalledOnce();
  expect(
    await cache.read('exact-public-binding-275', async () => '<h1>275</h1>')
  ).toContain('275');
});
it('does not poison retries and drops cleared in-flight fragments', async () => {
  const cache = createPublicRenderCache();
  await expect(
    cache.read('a', async () => {
      throw Error('failed render');
    })
  ).rejects.toThrow('failed render');
  let resolve: (html: string) => void = () => {};
  const old = cache.read(
    'a',
    () =>
      new Promise<string>((r) => {
        resolve = r;
      })
  );
  cache.clear();
  expect(await cache.read('a', async () => 'fresh')).toBe('fresh');
  resolve('old');
  expect(await old).toBe('old');
  expect(await cache.read('a', async () => 'wrong')).toBe('fresh');
});
it('bounds public fragment retention with LRU eviction and rejects oversize output', async () => {
  const cache = createPublicRenderCache({ maxEntries: 2, maxBytes: 12 });
  await cache.read('a', async () => 'one');
  await cache.read('b', async () => 'two');
  await cache.read('a', async () => 'wrong');
  await cache.read('c', async () => 'three');
  const reload = vi.fn(async () => 'new');
  expect(await cache.read('b', reload)).toBe('new');
  expect(reload).toHaveBeenCalledOnce();
  await expect(cache.read('huge', async () => 'x'.repeat(13))).rejects.toThrow(
    'QUOTA_EXCEEDED'
  );
});
