import {
  chmod,
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
import {
  GuestCartExpiredError,
  GuestCartStore,
  describeGuestCartStoreHealth,
} from './guest-cart-store';
import { releaseWriterLocks } from './guest-cart-writer-lock';
import { GuestCartStorageUnavailableError } from './guest-cart-writer-lock-errors';
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
  // Release locks before deleting their directories: an armed heartbeat
  // observing a missing lock file would fail closed with process.exit.
  releaseWriterLocks();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
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

it('reports a storage outage (not capacity) when eviction cannot delete', async () => {
  // Root bypasses permission bits, so the probe is meaningless there.
  if (typeof process.getuid === 'function' && process.getuid() === 0) return;
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
  try {
    await chmod(directory, 0o555);
    // Every eviction candidate fails with EACCES: the typed outage must
    // propagate (and flip /health) instead of degrading into a generic
    // capacity error after trying all 2,000 candidates.
    await expect(
      instance.update(undefined, { product_id: id, quantity: 1 }, async () => {})
    ).rejects.toBeInstanceOf(GuestCartStorageUnavailableError);
    expect(describeGuestCartStoreHealth(instance).guestCarts).toBe(
      'degraded'
    );
  } finally {
    await chmod(directory, 0o755);
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

it('runs the expiry sweep on token updates as well as creates', async () => {
  const { directory, instance } = await store();
  const created = await instance.update(
    undefined,
    { product_id: id, quantity: 1 },
    async () => {}
  );
  const dead = path.join(directory, `${'d'.repeat(64)}.json`);
  await writeFile(dead, JSON.stringify({ expires_at: 1, items: [] }));
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.now() + 61 * 1000);
    await instance.update(
      created.cart_token,
      { product_id: id, quantity: 2 },
      async () => {}
    );
  } finally {
    vi.useRealTimers();
  }
  await expect(readFile(dead, 'utf8')).rejects.toThrow();
});
