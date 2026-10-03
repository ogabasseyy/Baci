import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
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
