import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
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

function manifestFor({ bytes, sha, width = 48, height = 48 }) {
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
        contentType: 'image/webp',
        delivery: 'generated',
        format: 'webp',
        height,
        path: `${sha}.webp`,
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

describe('checkBindingManifest', () => {
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
