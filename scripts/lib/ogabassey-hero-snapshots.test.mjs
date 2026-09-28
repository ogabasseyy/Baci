import {
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
import { SNAPSHOT_WIDTHS } from './ogabassey-hero-snapshot-config.mjs';
import { readSnapshotManifestTenants } from './ogabassey-hero-snapshot-manifest-read.mjs';
import { runGenerateOgabasseyHeroSnapshots } from './ogabassey-hero-snapshots.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

function makeFakeFetch({ failingUrls = [] } = {}) {
  return vi.fn(async (url) => {
    const failing = failingUrls.some((bad) => String(url).includes(bad));
    return {
      ok: !failing,
      status: failing ? 500 : 200,
      url: String(url),
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from('fake-source-bytes'),
    };
  });
}

function makeFakeSharp({ sourceWidth = 1600 } = {}) {
  return (input) => {
    const chain = {
      _width: null,
      rotate() {
        return chain;
      },
      resize({ width }) {
        chain._width = width;
        return chain;
      },
      avif() {
        return chain;
      },
      async toBuffer() {
        return Buffer.from(`fake-avif-v1-${chain._width}`);
      },
      async metadata() {
        if (Buffer.isBuffer(input)) {
          return { width: sourceWidth, format: 'jpeg' };
        }
        const match = String(input).match(/-(\d+)\.avif$/);
        return { width: match ? Number(match[1]) : 0, format: 'heif' };
      },
    };
    return chain;
  };
}

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

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('runGenerateOgabasseyHeroSnapshots', () => {
  it('runs end to end: bakes, writes, then prunes', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-run-'));
    const manifestPath = seedManifestFile(webRoot);
    const outDir = resolve(webRoot, 'public/_hero/ogabassey');
    mkdirSync(outDir, { recursive: true });
    const orphan = 'cccccccccccc-640.avif';
    writeFileSync(resolve(outDir, orphan), 'stale');

    const { entries, slug } = await runGenerateOgabasseyHeroSnapshots(
      ['node', 's.mjs', '--slug', 'ogabassey', SOURCE_URL],
      {
        fetchImpl: makeFakeFetch(),
        sharpImpl: makeFakeSharp(),
        skipBiomeFormat: true,
        webRoot,
      }
    );

    expect(slug).toBe('ogabassey');
    expect(entries).toHaveLength(1);
    expect(existsSync(resolve(outDir, orphan))).toBe(false);
    expect(readdirSync(outDir)).toHaveLength(SNAPSHOT_WIDTHS.length);
    const { tenants } = readSnapshotManifestTenants(
      readFileSync(manifestPath, 'utf8')
    );
    expect(Object.keys(tenants.ogabassey)).toEqual([SOURCE_URL]);
    expect(tenants['other-tenant']).toEqual({});
  });

  it('leaves the manifest and orphans untouched when a later url fails', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-run-'));
    const manifestPath = seedManifestFile(webRoot);
    const outDir = resolve(webRoot, 'public/_hero/ogabassey');
    mkdirSync(outDir, { recursive: true });
    const orphan = 'dddddddddddd-640.avif';
    writeFileSync(resolve(outDir, orphan), 'stale');
    const before = readFileSync(manifestPath, 'utf8');

    await expect(
      runGenerateOgabasseyHeroSnapshots(
        ['node', 's.mjs', '--slug', 'ogabassey', SOURCE_URL, 'https://cdn.x/bad.jpg'],
        {
          fetchImpl: makeFakeFetch({ failingUrls: ['bad.jpg'] }),
          sharpImpl: makeFakeSharp(),
          skipBiomeFormat: true,
          webRoot,
        }
      )
    ).rejects.toThrow(/HTTP 500/);

    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(existsSync(resolve(outDir, orphan))).toBe(true);
    // Rolled back: only the pre-seeded orphan remains, no partial bakes.
    expect(readdirSync(outDir)).toEqual([orphan]);
  });

  it('keeps old files when the manifest write fails (write precedes prune)', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-run-'));
    // No manifest seeded: the write step fails before pruning runs.
    const outDir = resolve(webRoot, 'public/_hero/ogabassey');
    mkdirSync(outDir, { recursive: true });
    const orphan = 'eeeeeeeeeeee-640.avif';
    writeFileSync(resolve(outDir, orphan), 'stale');

    await expect(
      runGenerateOgabasseyHeroSnapshots(
        ['node', 's.mjs', '--slug', 'ogabassey', SOURCE_URL],
        {
          fetchImpl: makeFakeFetch(),
          sharpImpl: makeFakeSharp(),
          skipBiomeFormat: true,
          webRoot,
        }
      )
    ).rejects.toThrow(/not found/);

    expect(existsSync(resolve(outDir, orphan))).toBe(true);
    // This run's baked files are removed; only the pre-existing orphan stays.
    expect(readdirSync(outDir)).toEqual([orphan]);
  });
});
