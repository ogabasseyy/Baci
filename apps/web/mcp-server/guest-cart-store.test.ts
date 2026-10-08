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
import { GuestCartExpiredError, GuestCartStore } from './guest-cart-store';
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

it('reclaims stale corrupt cart files while preserving fresh ones', async () => {
  const { directory, instance } = await store();
  // Jump past the throttle window plus any earlier fake-timer advancement in
  // this module so the sweep is guaranteed to run; pin the fresh file's mtime
  // to mocked now so the jump cannot age it into the reclaim window.
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 10 * 60 * 1000);
  try {
    const stale = path.join(directory, `${'e'.repeat(64)}.json`);
    const fresh = path.join(directory, `${'f'.repeat(64)}.json`);
    await writeFile(stale, 'not-json');
    await writeFile(fresh, 'not-json');
    await utimes(stale, new Date(Date.now() - 2 * 60 * 60 * 1000), new Date(Date.now() - 2 * 60 * 60 * 1000));
    await utimes(fresh, new Date(Date.now()), new Date(Date.now()));
    await instance.update(
      undefined,
      { product_id: id, quantity: 1 },
      async () => {}
    );
    await expect(readFile(stale, 'utf8')).rejects.toThrow();
    await expect(readFile(fresh, 'utf8')).resolves.toBe('not-json');
  } finally {
    vi.useRealTimers();
  }
});

it('evicts the least-recently-written cart at capacity', async () => {
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
  const oldest = path.join(directory, `${tokens[0]}.json`);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  await utimes(oldest, old, old);
  const cart = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  expect(cart.items).toEqual([{ product_id: id, quantity: 1 }]);
  await expect(readFile(oldest, 'utf8')).rejects.toThrow();
  const remaining = (await readdir(directory)).filter((entry) =>
    entry.endsWith('.json')
  );
  expect(remaining).toHaveLength(2000);
});

it('refuses a second writer while a live lock is held', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'guest-lock-live-'));
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    await writeFile(
      path.join(directory, '.writer.lock'),
      JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() })
    );
    expect(() => new GuestCartStore(directory)).toThrow(
      /Another MCP writer owns/
    );
    expect(logged.join('\n')).toContain('.writer.lock');
    expect(logged.join('\n')).toContain('99999999');
    expect(logged.join('\n')).toContain(`pid ${process.pid}`);
  } finally {
    console.error = originalError;
    await rm(directory, { recursive: true, force: true });
  }
});

it('reports expired or missing tokens distinctly so the caller can recover', async () => {
  const { directory, instance } = await store();
  const expiredToken = 'e'.repeat(64);
  await writeFile(
    path.join(directory, `${expiredToken}.json`),
    JSON.stringify({ expires_at: 1, items: [] })
  );
  await expect(
    instance.update(
      expiredToken,
      { product_id: id, quantity: 1 },
      async () => {}
    )
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
  await expect(
    readFile(path.join(directory, `${expiredToken}.json`), 'utf8')
  ).rejects.toThrow();
  await expect(
    instance.update(
      '0'.repeat(64),
      { product_id: id, quantity: 1 },
      async () => {}
    )
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
});

it('reports corrupt carts as expired and reclaims them', async () => {
  const { directory, instance } = await store();
  const corruptToken = 'f'.repeat(64);
  const corruptFile = path.join(directory, `${corruptToken}.json`);
  await writeFile(corruptFile, 'not-json');
  await expect(
    instance.update(corruptToken, { product_id: id, quantity: 1 }, async () => {})
  ).rejects.toBeInstanceOf(GuestCartExpiredError);
  await expect(readFile(corruptFile, 'utf8')).rejects.toThrow();
});
