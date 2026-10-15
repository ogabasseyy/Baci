import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { verifyStagedBytesAndFillers } from './lab-staged-verify';

// Filler-leg verification, split from lab-staged-verify.test.ts under
// the repo line ceiling: pinned-filler drift and the twin-set cache.
// readCalls counts staged reads for the cache test; the mock passes
// reads through to the real bounded reader.
const { readCalls } = vi.hoisted(() => ({
  readCalls: { count: 0 },
}));

vi.mock(
  '@/lib/merchant-image-variant-pilot/lab-config-stage-io-read',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/merchant-image-variant-pilot/lab-config-stage-io-read')
      >();
    return {
      ...actual,
      readUpToBytes: async (path: string, maxBytes: number) => {
        readCalls.count += 1;
        return actual.readUpToBytes(path, maxBytes);
      },
    };
  }
);

describe('verifyStagedBytesAndFillers', () => {
  it('passes verified merchant bytes with pinned fillers', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-fillers-ok-'));
    const tier = join(dir, 'tier.avif');
    const filler = join(dir, 'filler.png');
    const tierBytes = Buffer.from('tier');
    const fillerBytes = Buffer.from('filler');
    await writeFile(tier, tierBytes);
    await writeFile(filler, fillerBytes);
    const sha = (bytes: Buffer) =>
      createHash('sha256').update(bytes).digest('hex');
    await expect(
      verifyStagedBytesAndFillers(
        [{ path: tier, sha256: sha(tierBytes) }],
        [{ path: filler, sha256: sha(fillerBytes) }]
      )
    ).resolves.toBeUndefined();
  });

  it('fails closed with the version-control fix when a filler drifts', async () => {
    // Merchant bytes verify green while a filler was edited in place
    // (e.g. between control and pilot captures): the comparison would
    // skew silently without the filler leg. Re-staging cannot restore
    // committed fillers, so the error names the VCS restore instead.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-fillers-drift-'));
    const tier = join(dir, 'tier.avif');
    const filler = join(dir, 'filler.png');
    const tierBytes = Buffer.from('tier');
    await writeFile(tier, tierBytes);
    await writeFile(filler, 'edited bytes');
    const sha = (bytes: Buffer) =>
      createHash('sha256').update(bytes).digest('hex');
    await expect(
      verifyStagedBytesAndFillers(
        [{ path: tier, sha256: sha(tierBytes) }],
        [{ path: filler, sha256: sha(Buffer.from('filler')) }]
      )
    ).rejects.toThrow(/restore public\/__pilot\/fillers from version control/);
  });

  it('reads nothing on a repeat twin verification (both sets stay cached)', async () => {
    // The twin verifies two sets per request: a single-slot cache would
    // alternately evict so every GET re-hashes everything. Both sets
    // must hold their fast path across repeat calls.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-fillers-cache-'));
    const tier = join(dir, 'tier.avif');
    const filler = join(dir, 'filler.png');
    const tierBytes = Buffer.from('tier');
    const fillerBytes = Buffer.from('filler');
    await writeFile(tier, tierBytes);
    await writeFile(filler, fillerBytes);
    const sha = (bytes: Buffer) =>
      createHash('sha256').update(bytes).digest('hex');
    const staged = [{ path: tier, sha256: sha(tierBytes) }];
    const fillers = [{ path: filler, sha256: sha(fillerBytes) }];
    await verifyStagedBytesAndFillers(staged, fillers);
    const firstPassReads = readCalls.count;
    expect(firstPassReads).toBeGreaterThan(0);
    await verifyStagedBytesAndFillers(staged, fillers);
    expect(readCalls.count).toBe(firstPassReads);
  });
});
