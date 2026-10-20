import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  acceptanceFor,
  boundSourceFixture,
  GENERATION,
  manifestFor,
  outputRootWith,
  RECORD,
  sha256,
  tierBytes,
} from './merchant-image-pilot-preflight-offline-output-fixtures.mjs';

describe('merchant-image-pilot-preflight-offline-output-fixtures', () => {
  it('builds tier bytes, manifest, acceptance, and output root directory', async () => {
    const bytes = await tierBytes(48, 48);
    const sha = sha256(bytes);
    expect(sha).toHaveLength(64);

    const manifest = manifestFor({ bytes: bytes.length, sha });
    expect(manifest.assetId).toBe(RECORD.assetId);
    expect(manifest.tiers[0].sha256).toBe(sha);

    const acceptance = acceptanceFor([sha]);
    expect(acceptance.generationId).toBe(GENERATION);
    expect(acceptance.outputHashes).toEqual([sha]);
    expect(acceptance.qualities).toEqual([70]);

    const root = await outputRootWith(manifest, { [`${sha}.webp`]: bytes });
    const writtenManifest = JSON.parse(
      await readFile(
        join(root, 'generations', GENERATION, 'manifest.json'),
        'utf8'
      )
    );
    expect(writtenManifest.assetId).toBe('logo-a');
  });

  it('builds a content-derived bound source fixture', async () => {
    const bound = await boundSourceFixture();
    expect(bound.generationId).toHaveLength(64);
    expect(bound.sourceSha).toHaveLength(64);
    expect(bound.manifest.tiers).toHaveLength(6);
    expect(bound.inputBytes.byteLength).toBeGreaterThan(0);
  });
});
