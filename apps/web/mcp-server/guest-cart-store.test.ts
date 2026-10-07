import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { GuestCartStore } from './guest-cart-store';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const directories: string[] = [];
async function store() {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-cart-'));
  directories.push(directory);
  return { directory, instance: new GuestCartStore(directory) };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});
it('persists across server instances and makes an absolute-quantity retry safe', async () => {
  const { directory, instance } = await store();
  const first = await instance.update(
    undefined,
    { product_id: id, quantity: 2 },
    async () => {}
  );
  const restarted = new GuestCartStore(directory);
  const retry = await restarted.update(
    first.cart_token,
    { product_id: id, quantity: 2 },
    async () => {}
  );
  expect(retry.items).toEqual(first.items);
  expect(retry.cart_token).toBe(first.cart_token);
});
it('isolates guests, preserves other products, and removes a line', async () => {
  const { instance } = await store();
  const first = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  const second = await instance.update(
    undefined,
    { product_id: other, quantity: 3 },
    async () => {}
  );
  expect(second.cart_token).not.toBe(first.cart_token);
  const combined = await instance.update(
    first.cart_token,
    { product_id: other, quantity: 2 },
    async () => {}
  );
  expect(combined.items).toHaveLength(2);
  const removed = await instance.update(
    first.cart_token,
    { product_id: id, quantity: 0 },
    async () => {}
  );
  expect(removed.items).toEqual([{ product_id: other, quantity: 2 }]);
});
it('serializes overlapping writes and preserves the cart after failed validation', async () => {
  const { instance } = await store();
  const first = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  await expect(
    instance.update(
      first.cart_token,
      { product_id: id, quantity: 9 },
      async () => {
        throw new Error('stock');
      }
    )
  ).rejects.toThrow('stock');
  const [, last] = await Promise.all([
    instance.update(
      first.cart_token,
      { product_id: id, quantity: 2 },
      async () => {}
    ),
    instance.update(
      first.cart_token,
      { product_id: other, quantity: 1 },
      async () => {}
    ),
  ]);
  expect(last.items).toEqual([
    { product_id: id, quantity: 2 },
    { product_id: other, quantity: 1 },
  ]);
});
it('rejects invalid capabilities and expired carts', async () => {
  const { instance } = await store();
  await expect(
    instance.update(
      '../escape',
      { product_id: id, quantity: 1 },
      async () => {}
    )
  ).rejects.toThrow();
  const first = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 8 * 24 * 60 * 60 * 1000);
  await expect(
    instance.update(
      first.cart_token,
      { product_id: id, quantity: 1 },
      async () => {}
    )
  ).rejects.toThrow('expired');
});

it('sweeps stale crash temp files while preserving fresh ones', async () => {
  const { directory, instance } = await store();
  const staleTemp = path.join(
    directory,
    `${'a'.repeat(64)}.json.00000000-0000-4000-8000-000000000000.tmp`
  );
  const freshTemp = path.join(
    directory,
    `${'b'.repeat(64)}.json.00000000-0000-4000-8000-000000000001.tmp`
  );
  await writeFile(staleTemp, '{}');
  await writeFile(freshTemp, '{}');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(staleTemp, old, old);
  const cart = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  expect(cart.items).toEqual([{ product_id: id, quantity: 1 }]);
  await expect(readFile(staleTemp, 'utf8')).rejects.toThrow();
  await expect(readFile(freshTemp, 'utf8')).resolves.toBe('{}');
});

it('runs the expiry sweep at most once per minute', async () => {
  const { directory, instance } = await store();
  // Advance past the throttle window so the first creation sweeps no matter
  // which earlier tests already ran a sweep in this module.
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 61 * 1000);
  try {
    const swept = path.join(directory, `${'c'.repeat(64)}.json`);
    await writeFile(swept, JSON.stringify({ expires_at: 1, items: [] }));
    await instance.update(
      undefined,
      { product_id: id, quantity: 1 },
      async () => {}
    );
    await expect(readFile(swept, 'utf8')).rejects.toThrow();
    const deferred = path.join(directory, `${'d'.repeat(64)}.json`);
    await writeFile(deferred, JSON.stringify({ expires_at: 1, items: [] }));
    await instance.update(
      undefined,
      { product_id: other, quantity: 1 },
      async () => {}
    );
    await expect(readFile(deferred, 'utf8')).resolves.toContain('expires_at');
  } finally {
    vi.useRealTimers();
  }
});

it('does not count unrelated files against guest cart capacity', async () => {
  const { directory, instance } = await store();
  await Promise.all(
    Array.from({ length: 2000 }, (_, index) =>
      writeFile(path.join(directory, `unrelated-${index}.tmp`), '')
    )
  );
  const cart = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  expect(cart.items).toEqual([{ product_id: id, quantity: 1 }]);
});
