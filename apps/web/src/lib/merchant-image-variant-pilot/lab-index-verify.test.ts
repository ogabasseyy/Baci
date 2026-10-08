import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyOutputHashes } from './lab-index-verify';

const GENERATION_ID = 'd'.repeat(64);

async function setupGeneration(files: Record<string, Buffer>): Promise<string> {
  const outputRoot = join(
    tmpdir(),
    `pilot-index-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  const generationDir = join(outputRoot, 'generations', GENERATION_ID);
  await mkdir(generationDir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    await writeFile(join(generationDir, name), bytes);
  }
  return outputRoot;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('verifyOutputHashes', () => {
  it('returns null when every tier matches size and hash', async () => {
    const first = Buffer.from('tier-one-bytes');
    const second = Buffer.from('tier-two-bytes');
    const outputRoot = await setupGeneration({
      'one.avif': first,
      'two.webp': second,
    });
    const error = await verifyOutputHashes(outputRoot, GENERATION_ID, {
      tiers: [
        { bytes: first.length, path: 'one.avif', sha256: sha256(first) },
        { bytes: second.length, path: 'two.webp', sha256: sha256(second) },
      ],
    } as never);
    expect(error).toBeNull();
  });

  it('reports a missing tier file', async () => {
    const outputRoot = await setupGeneration({});
    const error = await verifyOutputHashes(outputRoot, GENERATION_ID, {
      tiers: [{ bytes: 4, path: 'gone.avif', sha256: '0'.repeat(64) }],
    } as never);
    expect(error).toMatch(/output missing: gone\.avif/);
  });

  it('reports a tier whose byte size changed', async () => {
    const bytes = Buffer.from('tier-bytes');
    const outputRoot = await setupGeneration({ 'tier.avif': bytes });
    const error = await verifyOutputHashes(outputRoot, GENERATION_ID, {
      tiers: [
        { bytes: bytes.length + 1, path: 'tier.avif', sha256: sha256(bytes) },
      ],
    } as never);
    expect(error).toMatch(/byte size changed: tier\.avif/);
  });

  it('rejects an oversized tier without allocating the whole file', async () => {
    // 2 MiB on disk against a 10-byte claim: the bounded read stops at
    // claim+1 and reports the size change instead of hashing megabytes.
    const bytes = Buffer.alloc(2 * 1024 * 1024, 7);
    const outputRoot = await setupGeneration({ 'huge.avif': bytes });
    const error = await verifyOutputHashes(outputRoot, GENERATION_ID, {
      tiers: [{ bytes: 10, path: 'huge.avif', sha256: sha256(bytes) }],
    } as never);
    expect(error).toMatch(/byte size changed: huge\.avif/);
  });

  it('reports a tier whose hash mismatches at the same size', async () => {
    const bytes = Buffer.from('tier-bytes');
    const outputRoot = await setupGeneration({ 'tier.avif': bytes });
    const error = await verifyOutputHashes(outputRoot, GENERATION_ID, {
      tiers: [
        { bytes: bytes.length, path: 'tier.avif', sha256: '1'.repeat(64) },
      ],
    } as never);
    expect(error).toMatch(/output hash mismatch: tier\.avif/);
  });

  it('reads a duplicated tier path once and still verifies it', async () => {
    const bytes = Buffer.from('shared-bytes');
    const outputRoot = await setupGeneration({ 'shared.avif': bytes });
    const error = await verifyOutputHashes(outputRoot, GENERATION_ID, {
      tiers: [
        { bytes: bytes.length, path: 'shared.avif', sha256: sha256(bytes) },
        { bytes: bytes.length, path: 'shared.avif', sha256: sha256(bytes) },
      ],
    } as never);
    expect(error).toBeNull();
  });
});
