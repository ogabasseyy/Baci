import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
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
it('takes over a stale writer lock', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-lock-stale-'));
  try {
    const lock = path.join(directory, '.writer.lock');
    await writeFile(lock, '{}');
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const instance = new GuestCartStore(directory);
    const cart = await instance.update(
      undefined,
      { product_id: id, quantity: 1 },
      async () => {}
    );
    expect(cart.items).toEqual([{ product_id: id, quantity: 1 }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('allows reentrant construction in the same process', async () => {
  const { directory } = await store();
  expect(() => new GuestCartStore(directory)).not.toThrow();
});

it('reports token liveness for live, expired, corrupt, and unknown carts', async () => {
  const { directory, instance } = await store();
  const created = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  await expect(instance.hasToken(created.cart_token)).resolves.toBe(true);
  await expect(instance.hasToken('0'.repeat(64))).resolves.toBe(false);
  await expect(instance.hasToken('bogus')).resolves.toBe(false);
  const expiredToken = 'e'.repeat(64);
  await writeFile(
    path.join(directory, `${expiredToken}.json`),
    JSON.stringify({ expires_at: 1, items: [] })
  );
  await expect(instance.hasToken(expiredToken)).resolves.toBe(false);
  const corruptToken = 'f'.repeat(64);
  await writeFile(path.join(directory, `${corruptToken}.json`), 'not-json');
  await expect(instance.hasToken(corruptToken)).resolves.toBe(false);
});

it('serializes eviction with in-flight updates instead of racing them', async () => {
  const { directory, instance } = await store();
  const tokens = Array.from({ length: 2000 }, (_, index) =>
    index.toString(16).padStart(64, '0')
  );
  const payload = JSON.stringify({
    expires_at: Date.now() + 7 * 24 * 60 * 60 * 1000,
    items: [],
  });
  for (const token of tokens)
    await writeFile(path.join(directory, `${token}.json`), payload);
  const now = Date.now();
  const aged = (token: string, at: number) =>
    utimes(
      path.join(directory, `${token}.json`),
      new Date(at),
      new Date(at)
    );
  await aged(tokens[0], now - 2 * 60 * 60 * 1000);
  await aged(tokens[1], now - 2 * 60 * 60 * 1000 + 1000);
  // The eviction chains behind this update, sees its refreshed mtime, and
  // skips it in favor of the next oldest cart.
  const updating = instance.update(
    tokens[0],
    { product_id: id, quantity: 1 },
    async () => {}
  );
  const creating = instance.update(
    undefined,
    { product_id: other, quantity: 1 },
    async () => {}
  );
  await expect(updating).resolves.toBeDefined();
  await expect(creating).resolves.toBeDefined();
  await expect(
    readFile(path.join(directory, `${tokens[0]}.json`), 'utf8')
  ).resolves.toContain(id);
  await expect(
    readFile(path.join(directory, `${tokens[1]}.json`), 'utf8')
  ).rejects.toThrow();
  const remaining = (await readdir(directory)).filter((entry) =>
    entry.endsWith('.json')
  );
  expect(remaining).toHaveLength(2000);
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
