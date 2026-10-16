import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  acceptanceFor,
  manifestFor,
  outputRootWith,
  sha256,
  tierBytes,
} from './merchant-image-pilot-preflight-offline-output-fixtures.mjs';
import { checkBindingTiers } from './merchant-image-pilot-preflight-offline-tiers.mjs';

describe('checkBindingTiers', () => {
  it('passes committed bytes that decode to the manifest geometry', async () => {
    const bytes = await tierBytes();
    const manifest = manifestFor({
      bytes: bytes.length,
      sha: sha256(bytes),
    });
    const root = await outputRootWith(manifest, {
      [`${sha256(bytes)}.webp`]: bytes,
    });
    const checks = [];
    const failures = [];
    const ok = await checkBindingTiers({
      acceptance: acceptanceFor([sha256(bytes)]),
      checks,
      failures,
      manifest,
      name: 'tiers-ok',
      options: { outputRoot: root },
    });
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it('rejects an oversized committed tier without allocating the whole file', async () => {
    // 2 MiB on disk against a small claim: the bounded read stops at
    // claim+1 and reports the mismatch instead of hashing megabytes.
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const root = await outputRootWith(manifest, {
      [`${sha}.webp`]: Buffer.concat([bytes, Buffer.alloc(2 * 1024 * 1024)]),
    });
    const checks = [];
    const failures = [];
    const ok = await checkBindingTiers({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'tiers-huge',
      options: { outputRoot: root },
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/hash mismatch/);
  });

  it('accepts an EXIF-rotated pass-through tier at its oriented geometry', async () => {
    // Stored 32x48 with orientation 6 renders 48x32; the manifest records
    // the oriented axes. Raw-axis comparison would reject this valid tier.
    const bytes = await sharp({
      create: { background: '#1c1917', channels: 3, height: 48, width: 32 },
    })
      .withMetadata({ orientation: 6 })
      .webp()
      .toBuffer();
    const manifest = manifestFor({
      bytes: bytes.length,
      height: 32,
      sha: sha256(bytes),
      width: 48,
    });
    manifest.tiers[0].delivery = 'original-passthrough';
    const root = await outputRootWith(manifest, {
      [`${sha256(bytes)}.webp`]: bytes,
    });
    const checks = [];
    const failures = [];
    const ok = await checkBindingTiers({
      acceptance: acceptanceFor([sha256(bytes)]),
      checks,
      failures,
      manifest,
      name: 'tiers-oriented',
      options: { outputRoot: root },
    });
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it('rejects truncated bodies that still report header metadata', async () => {
    const noise = randomBytes(256 * 256 * 3);
    const full = await sharp(noise, {
      raw: { channels: 3, height: 256, width: 256 },
    })
      .avif({ quality: 50 })
      .toBuffer();
    const bytes = full.subarray(0, Math.floor(full.length * 0.7));
    // Sanity: the AVIF header still reports format and dimensions, so a
    // metadata-only gate would pass this truncated body.
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(256);
    expect(meta.format).toBe('heif');
    const manifest = manifestFor({
      bytes: bytes.length,
      format: 'avif',
      height: 256,
      sha: sha256(bytes),
      width: 256,
    });
    const root = await outputRootWith(manifest, {
      [`${sha256(bytes)}.avif`]: bytes,
    });
    const checks = [];
    const failures = [];
    const ok = await checkBindingTiers({
      acceptance: acceptanceFor([sha256(bytes)]),
      checks,
      failures,
      manifest,
      name: 'tiers-truncated',
      options: { outputRoot: root },
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/does not decode/);
  });

  it('fails closed on unbound names and byte/geometry drift', async () => {
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const good = manifestFor({ bytes: bytes.length, sha });
    const root = await outputRootWith(good, { [`${sha}.webp`]: bytes });
    const options = { outputRoot: root };
    for (const [label, manifest, pattern] of [
      [
        'unbound-name',
        {
          ...good,
          tiers: [{ ...good.tiers[0], path: `${'f'.repeat(64)}.webp` }],
        },
        /not bound to its hash/,
      ],
      [
        'hash-drift',
        { ...good, tiers: [{ ...good.tiers[0], bytes: bytes.length + 1 }] },
        /hash mismatch/,
      ],
      [
        'geometry-drift',
        { ...good, tiers: [{ ...good.tiers[0], width: 96 }] },
        /decoded dimensions/,
      ],
    ]) {
      const checks = [];
      const failures = [];
      const ok = await checkBindingTiers({
        acceptance: acceptanceFor([sha]),
        checks,
        failures,
        manifest,
        name: label,
        options,
      });
      expect(ok, label).toBe(false);
      expect(failures.join('\n'), label).toMatch(pattern);
    }
  });

  it('fails closed when committed bytes do not decode', async () => {
    const bytes = Buffer.from('definitely not an image');
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const root = await outputRootWith(manifest, { [`${sha}.webp`]: bytes });
    const checks = [];
    const failures = [];
    const ok = await checkBindingTiers({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'tiers-decode',
      options: { outputRoot: root },
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/does not decode/);
  });
});
