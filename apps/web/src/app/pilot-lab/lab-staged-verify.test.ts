import { createHash } from 'node:crypto';
import {
  link,
  mkdtemp,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { verifyStagedBytes } from './lab-staged-verify';

// Paths whose staged read the suite reports as grown past the statted
// bound, deterministically reproducing a file that grows between the
// budget stat and the read.
const { grownPaths } = vi.hoisted(() => ({
  grownPaths: new Set<string>(),
}));

vi.mock(
  '@/lib/merchant-image-variant-pilot/lab-config-stage-io',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/merchant-image-variant-pilot/lab-config-stage-io')
      >();
    return {
      ...actual,
      readUpToBytes: async (path: string, maxBytes: number) => {
        if (grownPaths.has(path)) {
          return { bytes: Buffer.alloc(0), truncated: true };
        }
        return actual.readUpToBytes(path, maxBytes);
      },
    };
  }
);

describe('verifyStagedBytes', () => {
  it('passes when every staged file matches its verified hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-ok-'));
    const file = join(dir, 'tier.avif');
    const bytes = Buffer.from('bytes');
    await writeFile(file, bytes);
    await expect(
      verifyStagedBytes([
        {
          path: file,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ])
    ).resolves.toBeUndefined();
  });

  it('counts duplicated references once against the budgets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-dupe-'));
    const file = join(dir, 'tier.avif');
    const bytes = Buffer.from('bytes');
    await writeFile(file, bytes);
    const entry = {
      path: file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    // Same path+hash three times (passthrough reused across rungs):
    // one verification, not three budget charges.
    await expect(
      verifyStagedBytes([entry, { ...entry }, { ...entry }])
    ).resolves.toBeUndefined();
    // Same path with a conflicting hash is not a duplicate: both
    // entries verify, and the wrong expectation fails closed.
    await expect(
      verifyStagedBytes([entry, { ...entry, sha256: '0'.repeat(64) }])
    ).rejects.toThrow(/1 staged lab asset\(s\) unverified/);
  });

  it('rejects links even when the target bytes match the hash', async () => {
    // A symlink or hardlink swapped in after startup: matching bytes
    // must not validate (or cache), because the external target can
    // change out from under the hash before Next serves the file.
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-link-'));
    const bytes = Buffer.from('staged-bytes');
    const target = join(dir, 'target.avif');
    await writeFile(target, bytes);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const linked = join(dir, 'linked.avif');
    await symlink(target, linked);
    const hardlinked = join(dir, 'hardlinked.avif');
    await writeFile(hardlinked, bytes);
    await link(hardlinked, join(dir, 'outside.avif'));
    await expect(
      verifyStagedBytes([
        { path: linked, sha256 },
        { path: hardlinked, sha256 },
      ])
    ).rejects.toThrow(/2 staged lab asset\(s\) unverified/);
  });

  it('fails closed on missing or drifted bytes, naming the operator fix', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-bad-'));
    const drifted = join(dir, 'drifted.avif');
    await writeFile(drifted, 'swapped');
    await expect(
      verifyStagedBytes([
        { path: join(dir, 'gone.avif'), sha256: '0'.repeat(64) },
        { path: drifted, sha256: '0'.repeat(64) },
      ])
    ).rejects.toThrow(/2 staged lab asset\(s\) unverified/);
    await expect(
      verifyStagedBytes([
        { path: join(dir, 'gone.avif'), sha256: '0'.repeat(64) },
      ])
    ).rejects.toThrow(/pilot:stage and restart/);
    // Absolute server paths stay in the server log: the thrown message
    // carries the basename only.
    const failure = await verifyStagedBytes([
      { path: join(dir, 'gone.avif'), sha256: '0'.repeat(64) },
    ]).then(
      () => {
        throw new Error('expected verifyStagedBytes to reject');
      },
      (error: Error) => error.message
    );
    expect(failure).toContain('gone.avif');
    expect(failure).not.toContain(dir);
  });

  it('re-verifies after size/mtime change but skips the re-hash when unchanged', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-gate-'));
    const file = join(dir, 'tier.avif');
    const bytes = Buffer.from('12345678');
    await writeFile(file, bytes);
    const entry = {
      path: file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    await expect(verifyStagedBytes([entry])).resolves.toBeUndefined();
    // Same-size rewrite with a bumped mtime: the gate must re-run the
    // full read+hash and fail closed on the drifted bytes.
    await writeFile(file, Buffer.from('87654321'));
    const afterRewrite = await stat(file);
    const bumped = new Date(afterRewrite.mtimeMs + 2000);
    await utimes(file, bumped, bumped);
    await expect(verifyStagedBytes([entry])).rejects.toThrow(/hash drift/);
    // Restore the verified bytes (bumped mtime forces a real re-hash).
    await writeFile(file, bytes);
    const afterRestore = await stat(file);
    const restored = new Date(afterRestore.mtimeMs + 2000);
    await utimes(file, restored, restored);
    await expect(verifyStagedBytes([entry])).resolves.toBeUndefined();
    // Same-size rewrite with the mtime pinned back: the write itself
    // bumps ctime, which the fingerprint binds, so the gate re-runs the
    // full read+hash and fails closed on the drifted bytes.
    await writeFile(file, Buffer.from('87654321'));
    await utimes(file, restored, restored);
    await expect(verifyStagedBytes([entry])).rejects.toThrow(/hash drift/);
    // Deletion after a passing verify still fails closed (missing
    // files never match the stored snapshot).
    await rm(file);
    await expect(verifyStagedBytes([entry])).rejects.toThrow(/missing/);
  });

  it('fails on size when a staged file grows between stat and read', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-grown-'));
    const file = join(dir, 'grown.avif');
    await writeFile(file, Buffer.alloc(4096, 7));
    grownPaths.add(file);
    try {
      // The read finds more than the statted bound: the file grew in
      // the stat-to-read window (or a giant was swapped in). The verify
      // must report size drift — an unbounded read would have buffered
      // the runaway bytes and reported hash drift instead.
      await expect(
        verifyStagedBytes([{ path: file, sha256: '0'.repeat(64) }])
      ).rejects.toThrow(/size drift/);
    } finally {
      grownPaths.delete(file);
    }
  });

  it('refuses staged sets beyond the per-request verification budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-budget-'));
    // 257 DISTINCT references: identical duplicates are deduped before
    // the budget applies, so the explosion case needs unique paths.
    const entries = Array.from({ length: 257 }, (_, index) => ({
      path: join(dir, `tier-${index}.avif`),
      sha256: '0'.repeat(64),
    }));
    await expect(verifyStagedBytes(entries)).rejects.toThrow(
      /257 staged lab asset\(s\) exceed the 256-entry/
    );
  });
});
