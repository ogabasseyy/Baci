import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_QUALITY } from './ogabassey-hero-snapshot-config.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { writeSnapshotManifest } from './ogabassey-hero-snapshot-manifest-write.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

const SEED_MANIFEST = `// seed manifest
export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 1;

export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: Record<
  string,
  Record<string, object>
> = {
  'other-tenant': {},
};
`;

function seedManifestFile(webRoot) {
  const dir = resolve(webRoot, 'src/config');
  mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, 'ogabassey-home-hero-snapshot-manifest.ts');
  writeFileSync(manifestPath, SEED_MANIFEST);
  return manifestPath;
}

function makeEntry(overrides = {}) {
  return {
    sourceUrl: SOURCE_URL,
    srcSet: '/_hero/ogabassey/aaa-640.avif 640w',
    href: '/_hero/ogabassey/aaa-640.avif',
    quality: SNAPSHOT_QUALITY,
    widths: [640],
    sourceSha256: 'b'.repeat(64),
    bakedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('writeSnapshotManifest', () => {
  it('writes slug entries while preserving other tenants', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-manifest-'));
    const manifestPath = seedManifestFile(webRoot);
    await writeSnapshotManifest({
      entries: [makeEntry()],
      manifestPath,
      root: webRoot,
      skipBiomeFormat: true,
      slug: 'ogabassey',
      webRoot,
    });

    const { tenants } = readSnapshotManifestTenants(
      readFileSync(manifestPath, 'utf8')
    );
    expect(tenants['other-tenant']).toEqual({});
    expect(tenants.ogabassey[SOURCE_URL].href).toBe(
      '/_hero/ogabassey/aaa-640.avif'
    );
  });

  it('leaves the live manifest untouched when formatting fails', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-manifest-'));
    const manifestPath = seedManifestFile(webRoot);
    const before = readFileSync(manifestPath, 'utf8');
    // A biome binary that exits nonzero, resolved via `root`.
    const binDir = resolve(webRoot, 'node_modules/.bin');
    mkdirSync(binDir, { recursive: true });
    const fakeBiome = resolve(binDir, 'biome');
    writeFileSync(fakeBiome, '#!/bin/sh\nexit 1\n');
    chmodSync(fakeBiome, 0o755);

    await expect(
      writeSnapshotManifest({
        entries: [makeEntry()],
        manifestPath,
        root: webRoot,
        skipBiomeFormat: false,
        slug: 'ogabassey',
        webRoot,
      })
    ).rejects.toThrow(/manifest formatting failed/);
    // Atomic replacement: the live file never changed, temp cleaned up.
    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(
      readdirSync(resolve(webRoot, 'src/config')).filter((f) =>
        f.includes('.tmp-')
      )
    ).toEqual([]);
  });

  it('removes stale temp siblings from killed runs', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-manifest-'));
    const manifestPath = seedManifestFile(webRoot);
    const stale = resolve(
      webRoot,
      'src/config/ogabassey-home-hero-snapshot-manifest.tmp-99999.ts'
    );
    writeFileSync(stale, 'stale');
    const unrelated = resolve(webRoot, 'src/config/notes.tmp-x.ts');
    writeFileSync(unrelated, 'hands off');

    await writeSnapshotManifest({
      entries: [makeEntry()],
      manifestPath,
      root: webRoot,
      skipBiomeFormat: true,
      slug: 'ogabassey',
      webRoot,
    });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(unrelated)).toBe(true);
  });

  it('fails when the manifest is missing', async () => {
    await expect(
      writeSnapshotManifest({
        entries: [],
        manifestPath: resolve(mkdtempSync(join(tmpdir(), 'hero-manifest-')), 'missing.ts'),
        root: '/tmp',
        skipBiomeFormat: true,
        slug: 'ogabassey',
        webRoot: '/tmp',
      })
    ).rejects.toThrow(/not found/);
  });
});
