import { createHash } from 'node:crypto';
import { mkdtemp, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyStagedBytes } from './lab-staged-verify';

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
    // Same-size rewrite with the mtime pinned back: documents the
    // mtime-trust assumption — the gate skips the re-hash, so a full
    // read here would fail but the gated check passes.
    await writeFile(file, Buffer.from('87654321'));
    await utimes(file, restored, restored);
    await expect(verifyStagedBytes([entry])).resolves.toBeUndefined();
    // Deletion after a passing verify still fails closed (missing
    // files never match the stored snapshot).
    await rm(file);
    await expect(verifyStagedBytes([entry])).rejects.toThrow(/missing/);
  });

  it('refuses staged sets beyond the per-request verification budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pilot-staged-budget-'));
    const file = join(dir, 'tier.avif');
    await writeFile(file, 'bytes');
    const entry = { path: file, sha256: '0'.repeat(64) };
    await expect(
      verifyStagedBytes(Array.from({ length: 257 }, () => entry))
    ).rejects.toThrow(/257 staged lab asset\(s\) exceed the 256-entry/);
  });
});
