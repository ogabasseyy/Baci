import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RECIPE_ID } from '../../../../infra/cdn-transformer/pilot/constants.mjs';
import {
  checkBindingManifest,
  checkBindingStaged,
  checkBindingTiers,
} from './merchant-image-pilot-preflight-offline-output.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const GENERATION = 'c'.repeat(64);

function tierBytes(width = 48, height = 48) {
  return sharp({
    create: { background: '#1c1917', channels: 3, height, width },
  })
    .webp()
    .toBuffer();
}

function manifestFor({ bytes, format = 'webp', sha, width = 48, height = 48 }) {
  return {
    assetId: 'logo-a',
    createdAt: '2026-10-01T10:00:00Z',
    encoder: { libvipsVersion: '8.16', name: 'sharp', sharpVersion: '0.34' },
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    policyVersion: 1,
    recipeId: 'pilot/r1',
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: 100,
      format: 'png',
      orientedHeight: 48,
      orientedWidth: 48,
      sha256: 'd'.repeat(64),
    },
    tiers: [
      {
        actualWidth: width,
        bytes,
        contentType: `image/${format}`,
        delivery: 'generated',
        format,
        height,
        path: `${sha}.${format}`,
        quality: 70,
        requestedWidth: width,
        sha256: sha,
        width,
      },
    ],
  };
}

async function outputRootWith(manifest, files = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pilot-offline-output-'));
  const dir = join(root, 'generations', GENERATION);
  await mkdir(dir, { recursive: true });
  if (manifest) {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  }
  for (const [path, bytes] of Object.entries(files)) {
    await writeFile(join(dir, path), bytes);
  }
  return root;
}

const RECORD = {
  assetId: 'logo-a',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  role: 'logo',
  sha256: 'd'.repeat(64),
  sourcePath: 'snapshots/logo-a.png',
};

function acceptanceFor(hashes) {
  return { generationId: GENERATION, outputHashes: hashes };
}

async function boundSourceFixture() {
  const inputBytes = await sharp({
    create: { background: '#1c1917', channels: 3, height: 288, width: 384 },
  })
    .png()
    .toBuffer();
  const sourceSha = sha256(inputBytes);
  const tiers = [];
  for (const requestedWidth of [96, 192, 384]) {
    for (const format of ['avif', 'webp']) {
      const hash = sha256(Buffer.from(`tier:${requestedWidth}:${format}`));
      tiers.push({
        actualWidth: requestedWidth,
        bytes: 100,
        contentType: `image/${format}`,
        delivery:
          inputBytes.length >= 100 ? 'generated' : 'generated-over-source',
        format,
        height: Math.round((288 * requestedWidth) / 384),
        path: `${hash}.${format}`,
        quality: 70,
        requestedWidth,
        sha256: hash,
        width: requestedWidth,
      });
    }
  }
  const manifest = {
    assetId: 'logo-a',
    createdAt: '2026-10-01T10:00:00Z',
    encoder: { libvipsVersion: '8.16', name: 'sharp', sharpVersion: '0.34' },
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    policyVersion: 1,
    recipeId: RECIPE_ID,
    role: 'logo',
    schemaVersion: 1,
    source: {
      bytes: inputBytes.length,
      format: 'png',
      orientedHeight: 288,
      orientedWidth: 384,
      sha256: sourceSha,
    },
    tiers,
  };
  return { inputBytes, manifest, sourceSha };
}

describe('checkBindingManifest', () => {
  it('binds manifest source facts to the verified input bytes', async () => {
    const { inputBytes, manifest, sourceSha } = await boundSourceFixture();
    const root = await outputRootWith(manifest);
    const checks = [];
    const failures = [];
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(manifest.tiers.map((tier) => tier.sha256)),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes,
      name: 'bound',
      options: { outputRoot: root },
      record: { ...RECORD, sha256: sourceSha },
    });
    expect(parsed).not.toBeNull();
    expect(failures).toEqual([]);
  });

  it('compares acceptance hashes positionally, not as a sorted set', async () => {
    const { inputBytes, manifest, sourceSha } = await boundSourceFixture();
    const root = await outputRootWith(manifest);
    const checks = [];
    const failures = [];
    // Same hashes, reversed: a sorted-set comparison would pass, but the
    // runtime matcher binds each hash to one rung positionally.
    const parsed = await checkBindingManifest({
      acceptance: acceptanceFor(
        manifest.tiers.map((tier) => tier.sha256).reverse()
      ),
      checks,
      effectiveRecipe: RECIPE_ID,
      failures,
      inputBytes,
      name: 'reversed',
      options: { outputRoot: root },
      record: { ...RECORD, sha256: sourceSha },
    });
    expect(parsed).toBeNull();
    expect(failures.join('\n')).toMatch(/acceptance hashes differ/);
  });

  it('rejects source-fact drift against the verified input', async () => {
    const { inputBytes, manifest, sourceSha } = await boundSourceFixture();
    const record = { ...RECORD, sha256: sourceSha };
    for (const [label, patch, pattern] of [
      ['bytes', { bytes: inputBytes.length + 1 }, /claims .* bytes/],
      ['format', { format: 'jpeg' }, /claims format/],
      ['dims', { orientedWidth: 385 }, /decodes/],
    ]) {
      const root = await outputRootWith({
        ...manifest,
        source: { ...manifest.source, ...patch },
      });
      const checks = [];
      const failures = [];
      const parsed = await checkBindingManifest({
        acceptance: acceptanceFor(manifest.tiers.map((tier) => tier.sha256)),
        checks,
        effectiveRecipe: RECIPE_ID,
        failures,
        inputBytes,
        name: label,
        options: { outputRoot: root },
        record,
      });
      expect(parsed, label).toBeNull();
      expect(failures.join('\n'), label).toMatch(pattern);
    }
  });

  it('fails closed when the manifest is missing or malformed', async () => {
    const root = await outputRootWith(null);
    for (const [label, setup] of [
      ['missing', async () => root],
      [
        'malformed',
        async () => {
          await writeFile(
            join(root, 'generations', GENERATION, 'manifest.json'),
            JSON.stringify({ assetId: 'logo-a' })
          );
          return root;
        },
      ],
    ]) {
      const checks = [];
      const failures = [];
      const manifest = await checkBindingManifest({
        acceptance: acceptanceFor(['e'.repeat(64)]),
        checks,
        effectiveRecipe: 'pilot/r1',
        failures,
        name: label,
        options: { outputRoot: await setup() },
        record: RECORD,
      });
      expect(manifest, label).toBeNull();
      expect(failures.length, label).toBeGreaterThan(0);
    }
  });
});

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

describe('checkBindingStaged', () => {
  it('passes staged copies that hash identically, incl. the original', async () => {
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-staged-'));
    await mkdir(join(publicDir, '__pilot', GENERATION), { recursive: true });
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    await writeFile(
      join(publicDir, '__pilot', GENERATION, `${sha}.webp`),
      bytes
    );
    const original = Buffer.from('original-bytes');
    await writeFile(
      join(
        publicDir,
        '__pilot',
        'originals',
        '6b5cb8a4-5575-456c-b936-8cdfae30db74-logo-a.png'
      ),
      original
    );
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-ok',
      options: { publicDir },
      record: { ...RECORD, sha256: sha256(original) },
    });
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it('locates the staged original by verified format under a lying filename', async () => {
    // PNG bytes inventoried as photo.jpg: the loader stages a .png
    // original, so the staged check must look for .png too — a
    // correctly staged binding cannot fail on the filename lie.
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-liename-'));
    await mkdir(join(publicDir, '__pilot', GENERATION), { recursive: true });
    await mkdir(join(publicDir, '__pilot', 'originals'), { recursive: true });
    await writeFile(
      join(publicDir, '__pilot', GENERATION, `${sha}.webp`),
      bytes
    );
    const original = Buffer.from('original-bytes');
    await writeFile(
      join(
        publicDir,
        '__pilot',
        'originals',
        '6b5cb8a4-5575-456c-b936-8cdfae30db74-logo-a.png'
      ),
      original
    );
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-liename',
      options: { publicDir },
      record: {
        ...RECORD,
        sha256: sha256(original),
        sourcePath: 'snapshots/photo.jpg',
      },
    });
    expect(ok).toBe(true);
    expect(failures).toEqual([]);
  });

  it('fails closed on missing or drifted staged bytes', async () => {
    const bytes = await tierBytes();
    const sha = sha256(bytes);
    const manifest = manifestFor({ bytes: bytes.length, sha });
    const publicDir = await mkdtemp(join(tmpdir(), 'pilot-offline-staged-'));
    const checks = [];
    const failures = [];
    const ok = await checkBindingStaged({
      acceptance: acceptanceFor([sha]),
      checks,
      failures,
      manifest,
      name: 'staged-missing',
      options: { publicDir },
      record: RECORD,
    });
    expect(ok).toBe(false);
    expect(failures.join('\n')).toMatch(/staged derivative missing/);
  });
});
