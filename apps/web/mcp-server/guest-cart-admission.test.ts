import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  admitGuestCartWrite,
  didCartFileChange,
  runExclusive,
} from './guest-cart-admission';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const directories: string[] = [];
async function directory() {
  const created = await mkdtemp(path.join(tmpdir(), 'guest-admit-'));
  directories.push(created);
  return created;
}
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((created) => rm(created, { recursive: true, force: true }))
  );
});

it('sweeps expired carts and stale temps without touching live carts', async () => {
  const root = await directory();
  const live = 'a'.repeat(64);
  const dead = 'd'.repeat(64);
  await writeFile(
    path.join(root, `${live}.json`),
    JSON.stringify({ expires_at: Date.now() + 3_600_000, items: [] })
  );
  await writeFile(
    path.join(root, `${dead}.json`),
    JSON.stringify({ expires_at: 1, items: [] })
  );
  const staleTemp = path.join(root, `${live}.json.abc.tmp`);
  const freshTemp = path.join(root, `${live}.json.def.tmp`);
  await writeFile(staleTemp, '{}');
  await writeFile(freshTemp, '{}');
  const old = new Date(Date.now() - 2 * 3_600_000);
  await utimes(staleTemp, old, old);
  await admitGuestCartWrite(root, false);
  await expect(
    readFile(path.join(root, `${dead}.json`), 'utf8')
  ).rejects.toThrow();
  await expect(readFile(staleTemp, 'utf8')).rejects.toThrow();
  await expect(
    readFile(path.join(root, `${live}.json`), 'utf8')
  ).resolves.toContain('expires_at');
  await expect(readFile(freshTemp, 'utf8')).resolves.toBe('{}');
});

it('admits without evicting below capacity', async () => {
  const root = await directory();
  const payload = JSON.stringify({
    expires_at: Date.now() + 3_600_000,
    items: [],
  });
  for (const name of ['a', 'b', 'c'])
    await writeFile(path.join(root, `${name.repeat(64)}.json`), payload);
  await admitGuestCartWrite(root, true);
  const remaining = (await readdir(root)).filter((entry) =>
    entry.endsWith('.json')
  );
  expect(remaining).toHaveLength(3);
});

it('evicts the least-recently-written cart when admitting at capacity', async () => {
  const root = await directory();
  const tokens = Array.from({ length: 2000 }, (_, index) =>
    index.toString(16).padStart(64, '0')
  );
  const payload = JSON.stringify({
    expires_at: Date.now() + 3_600_000,
    items: [],
  });
  for (const token of tokens)
    await writeFile(path.join(root, `${token}.json`), payload);
  const old = new Date(Date.now() - 2 * 3_600_000);
  await utimes(path.join(root, `${tokens[0]}.json`), old, old);
  const logged: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    await admitGuestCartWrite(root, true);
  } finally {
    console.log = originalLog;
  }
  expect(logged.join('\n')).toContain('evicted_at_capacity');
  await expect(
    readFile(path.join(root, `${tokens[0]}.json`), 'utf8')
  ).rejects.toThrow();
  await expect(
    readFile(path.join(root, `${tokens[1]}.json`), 'utf8')
  ).resolves.toContain('expires_at');
});

it(
  'spares a queued update that kept its snapshot mtime',
  { timeout: 30000 },
  async () => {
  const root = await directory();
  const tokens = Array.from({ length: 2000 }, (_, index) =>
    index.toString(16).padStart(64, '0')
  );
  const payload = JSON.stringify({
    expires_at: Date.now() + 3_600_000,
    items: [],
  });
  for (const token of tokens)
    await writeFile(path.join(root, `${token}.json`), payload);
  const oldest = path.join(root, `${tokens[0]}.json`);
  const old = new Date(Date.now() - 2 * 3_600_000);
  await utimes(oldest, old, old);
  // A racing update atomically replaces the file on every iteration while
  // admission runs. The replacement carries the snapshot mtime from the
  // start (rename preserves timestamps), the way a coarse-resolution
  // filesystem would keep it, so no stat can observe a newer timestamp.
  // The temp file lives outside the cart directory so the crash-temp
  // janitor never mistakes it for an orphan.
  const fresh = JSON.stringify({
    expires_at: Date.now() + 3_600_000,
    items: [
      {
        product_id: '11111111-1111-4111-8111-111111111111',
        quantity: 1,
      },
    ],
  });
  const churnDir = await directory();
  const temp = path.join(churnDir, 'churn.tmp');
  let churning = true;
  const churn = (async () => {
    while (churning) {
      await writeFile(temp, fresh);
      await utimes(temp, old, old);
      await rename(temp, oldest);
    }
  })();
  // Pin the reclaim loop at the victim: the first occupant stalls its
  // reclaim callback, and the blocker below (queued while the loop is
  // stalled, hence behind the callback in FIFO order) then stalls its
  // eviction callback. The churn above keeps replacing the file across
  // the stretched window, so the snapshot and the callback are guaranteed
  // to observe different generations. The sleeps carry wide margins over
  // the measured loop (~1s even loaded); a missed margin fails loudly
  // below via eviction.
  let releasePin!: () => void;
  const pinGate = new Promise<void>((resolve) => {
    releasePin = resolve;
  });
  const pinning = runExclusive(oldest, () => pinGate);
  const admitting = admitGuestCartWrite(root, true);
  await sleep(4000);
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  let blockerStarted!: () => void;
  const blockerRunning = new Promise<void>((resolve) => {
    blockerStarted = resolve;
  });
  const blocking = runExclusive(oldest, async () => {
    blockerStarted();
    await gate;
  });
  releasePin();
  await blockerRunning;
  await sleep(6000);
  churning = false;
  await churn;
  releaseGate();
  await admitting;
  await blocking;
  await pinning;
  await expect(readFile(oldest, 'utf8')).resolves.toContain('product_id');
  // Exactly one cart is evicted; which one is load-dependent (a transient
  // stat failure under parallel pressure skips a candidate and the loop
  // moves on), so only the victim's survival is pinned down.
  const remaining = (await readdir(root)).filter((entry) =>
    entry.endsWith('.json')
  );
  expect(remaining).toHaveLength(1999);
  }
);

it('treats an equal-mtime inode change as a fresh cart file', () => {
  const snapshot = { mtimeMs: 100, ino: 1 };
  expect(didCartFileChange(snapshot, { mtimeMs: 100, ino: 1 })).toBe(false);
  expect(didCartFileChange(snapshot, { mtimeMs: 100, ino: 2 })).toBe(true);
  expect(didCartFileChange(snapshot, { mtimeMs: 101, ino: 1 })).toBe(true);
});
