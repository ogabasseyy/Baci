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
import { afterEach, expect, it } from 'vitest';
import { admitGuestCartWrite } from './guest-cart-admission';

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
  await admitGuestCartWrite(root, true);
  await expect(
    readFile(path.join(root, `${tokens[0]}.json`), 'utf8')
  ).rejects.toThrow();
  await expect(
    readFile(path.join(root, `${tokens[1]}.json`), 'utf8')
  ).resolves.toContain('expires_at');
});
