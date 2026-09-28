import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SNAPSHOT_QUALITY } from './ogabassey-hero-snapshot-config.mjs';
import {
  readSnapshotManifestTenants,
  serializeSnapshotManifestBody,
  writeSnapshotManifest,
} from './ogabassey-hero-snapshot-manifest.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

const SEED_MANIFEST = `// seed manifest
export interface OgabasseyHomeHeroSnapshotManifestEntry {
  sourceUrl: string;
  srcSet: string;
  href: string;
  quality: number;
  widths: number[];
  sourceSha256: string;
}

export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 1;

export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: Record<
  string,
  Record<string, OgabasseyHomeHeroSnapshotManifestEntry>
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('readSnapshotManifestTenants', () => {
  it('round-trips formatted output and preserves tenants', () => {
    const file =
      `export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 3;\n\n` +
      `export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: Record<string, Record<string, object>> = ` +
      `{\n  ogabassey: {\n    'https://x/y.jpg': {\n      sourceUrl: 'https://x/y.jpg',\n    },\n  },\n};\n`;
    const { tenants, version } = readSnapshotManifestTenants(file);
    expect(version).toBe(3);
    expect(tenants.ogabassey['https://x/y.jpg'].sourceUrl).toBe(
      'https://x/y.jpg'
    );
  });

  it('rejects a corrupt body', () => {
    expect(() =>
      readSnapshotManifestTenants('> = { not valid !!!\n};\n')
    ).toThrow(/not parseable/);
  });

  it('treats a missing body as empty (fresh manifest edge)', () => {
    const { tenants, version } = readSnapshotManifestTenants(
      'export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 2;\n'
    );
    expect(version).toBe(2);
    expect(tenants).toEqual({});
  });
});

describe('serializeSnapshotManifestBody', () => {
  it('refuses values that break single-quote serialization', () => {
    expect(() =>
      serializeSnapshotManifestBody({
        ogabassey: { x: makeEntry({ sourceUrl: "o'brien" }) },
      })
    ).toThrow(/breaks manifest serialization/);
  });
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
