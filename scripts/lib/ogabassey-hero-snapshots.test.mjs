import { createHash } from 'node:crypto';
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
import {
  bakeSnapshots,
  DEFAULT_WIDTH,
  defaultManifestPath,
  defaultWebRoot,
  fetchSnapshotSource,
  HeroSnapshotError,
  MANAGED_FILE_PATTERN,
  MAX_SOURCE_BYTES,
  parseSnapshotArgs,
  pruneSnapshotOrphans,
  readSnapshotManifestTenants,
  runGenerateOgabasseyHeroSnapshots,
  serializeSnapshotManifestBody,
  SNAPSHOT_QUALITY,
  SNAPSHOT_WIDTHS,
  writeSnapshotManifest,
} from './ogabassey-hero-snapshots.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

function makeFakeFetch({
  bytes = Buffer.from('fake-source-bytes'),
  contentType = 'image/jpeg',
  status = 200,
} = {}) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) =>
        String(name).toLowerCase() === 'content-type' ? contentType : null,
    },
    arrayBuffer: async () => bytes,
  }));
}

// Faithful-enough sharp double: metadata reports the source width for
// buffers and parses the baked width back out of managed filenames.
function makeFakeSharp({ bakedWidth = null, encodeTag = 'v1', sourceWidth = 1600 } = {}) {
  return (input) => {
    const chain = {
      _width: null,
      resize({ width }) {
        chain._width = width;
        return chain;
      },
      avif() {
        return chain;
      },
      async toBuffer() {
        return Buffer.from(`fake-avif-${encodeTag}-${chain._width}`);
      },
      async metadata() {
        if (Buffer.isBuffer(input)) {
          return { width: sourceWidth, format: 'jpeg' };
        }
        const match = String(input).match(/-(\d+)\.avif$/);
        return {
          width: bakedWidth ?? (match ? Number(match[1]) : 0),
          format: 'heif',
        };
      },
    };
    return chain;
  };
}

function makeTempWebRoot() {
  return mkdtempSync(join(tmpdir(), 'hero-snapshots-'));
}

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

describe('parseSnapshotArgs', () => {
  it('parses slug and dedupes/trims urls', () => {
    expect(
      parseSnapshotArgs([
        'node',
        'script.mjs',
        '--slug',
        'ogabassey',
        `  ${SOURCE_URL} `,
        SOURCE_URL,
      ])
    ).toEqual({ slug: 'ogabassey', urls: [SOURCE_URL] });
  });

  it('rejects a missing or malformed slug', () => {
    expect(() => parseSnapshotArgs(['node', 's.mjs', SOURCE_URL])).toThrow(
      HeroSnapshotError
    );
    expect(() =>
      parseSnapshotArgs(['node', 's.mjs', '--slug', 'Oga_Bassey!', SOURCE_URL])
    ).toThrow(/--slug/);
  });

  it('rejects unknown flags', () => {
    expect(() =>
      parseSnapshotArgs([
        'node',
        's.mjs',
        '--slug',
        'ogabassey',
        '--quality',
        '80',
        SOURCE_URL,
      ])
    ).toThrow(/unknown flag/);
  });

  it('rejects an empty url set', () => {
    expect(() =>
      parseSnapshotArgs(['node', 's.mjs', '--slug', 'ogabassey'])
    ).toThrow(/at least one/);
  });
});

describe('fetchSnapshotSource', () => {
  it('returns bytes for a valid image response', async () => {
    const bytes = await fetchSnapshotSource(SOURCE_URL, makeFakeFetch());
    expect(Buffer.from(bytes).toString()).toBe('fake-source-bytes');
  });

  it.each([
    ['not a url', /not a URL/],
    ['http://cdn.ogabassey.com/x.jpg', /non-https/],
  ])('rejects %s', async (url, pattern) => {
    await expect(fetchSnapshotSource(url, makeFakeFetch())).rejects.toThrow(
      pattern
    );
  });

  it('rejects http errors', async () => {
    await expect(
      fetchSnapshotSource(SOURCE_URL, makeFakeFetch({ status: 404 }))
    ).rejects.toThrow(/HTTP 404/);
  });

  it('rejects non-image content', async () => {
    await expect(
      fetchSnapshotSource(
        SOURCE_URL,
        makeFakeFetch({ contentType: 'text/html' })
      )
    ).rejects.toThrow(/content-type/);
  });

  it('rejects empty and oversized bodies', async () => {
    await expect(
      fetchSnapshotSource(SOURCE_URL, makeFakeFetch({ bytes: Buffer.alloc(0) }))
    ).rejects.toThrow(/0 bytes/);
    await expect(
      fetchSnapshotSource(
        SOURCE_URL,
        makeFakeFetch({ bytes: Buffer.alloc(MAX_SOURCE_BYTES + 1) })
      )
    ).rejects.toThrow(/limit/);
  });
});

describe('bakeSnapshots', () => {
  it('bakes the full width ladder with encoded-hash names', async () => {
    const outDir = resolve(makeTempWebRoot(), 'public/_hero/ogabassey');
    const entries = await bakeSnapshots({
      fetchImpl: makeFakeFetch(),
      outDir,
      sharpImpl: makeFakeSharp(),
      slug: 'ogabassey',
      urls: [SOURCE_URL],
    });

    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry.sourceUrl).toBe(SOURCE_URL);
    expect(entry.quality).toBe(SNAPSHOT_QUALITY);
    expect(entry.widths).toEqual([...SNAPSHOT_WIDTHS].sort((a, b) => a - b));
    // Filenames hash the ENCODED bytes: same encoder output, same URL.
    for (const width of SNAPSHOT_WIDTHS) {
      const expected = createHash('sha256')
        .update(`fake-avif-v1-${width}`)
        .digest('hex')
        .slice(0, 12);
      expect(entry.srcSet).toContain(`/_hero/ogabassey/${expected}-${width}.avif ${width}w`);
      expect(existsSync(resolve(outDir, `${expected}-${width}.avif`))).toBe(true);
    }
    // Preload href is the nearest-to-960 file.
    const hrefWidth = [...SNAPSHOT_WIDTHS].sort(
      (a, b) => Math.abs(a - DEFAULT_WIDTH) - Math.abs(b - DEFAULT_WIDTH)
    )[0];
    expect(entry.srcSet).toContain(entry.href);
    expect(entry.href.endsWith(`-${hrefWidth}.avif`)).toBe(true);
  });

  it('refuses to upscale a source narrower than the widest snapshot', async () => {
    const outDir = resolve(makeTempWebRoot(), 'public/_hero/ogabassey');
    await expect(
      bakeSnapshots({
        fetchImpl: makeFakeFetch(),
        outDir,
        sharpImpl: makeFakeSharp({ sourceWidth: 800 }),
        slug: 'ogabassey',
        urls: [SOURCE_URL],
      })
    ).rejects.toThrow(/800px wide/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('rejects a baked file whose dimensions do not match', async () => {
    const outDir = resolve(makeTempWebRoot(), 'public/_hero/ogabassey');
    await expect(
      bakeSnapshots({
        fetchImpl: makeFakeFetch(),
        outDir,
        sharpImpl: makeFakeSharp({ bakedWidth: 1 }),
        slug: 'ogabassey',
        urls: [SOURCE_URL],
      })
    ).rejects.toThrow(/want \d+px\/avif/);
  });

  it('mints new urls when the encoder output changes (immutable safety)', async () => {
    const bake = (encodeTag) =>
      bakeSnapshots({
        fetchImpl: makeFakeFetch(),
        outDir: resolve(makeTempWebRoot(), 'public/_hero/ogabassey'),
        sharpImpl: makeFakeSharp({ encodeTag }),
        slug: 'ogabassey',
        urls: [SOURCE_URL],
      });
    const [before] = await bake('v1');
    const [after] = await bake('v2-quality-bump');
    expect(after.srcSet).not.toBe(before.srcSet);

    const [repeat] = await bake('v1');
    expect(repeat.srcSet).toBe(before.srcSet);
    expect(repeat.href).toBe(before.href);
  });
});

describe('pruneSnapshotOrphans', () => {
  it('prunes only unreferenced pipeline-managed files', () => {
    const outDir = resolve(makeTempWebRoot(), 'public/_hero/ogabassey');
    mkdirSync(outDir, { recursive: true });
    const kept = 'aaaaaaaaaaaa-640.avif';
    const orphan = 'bbbbbbbbbbbb-640.avif';
    const foreign = 'hand-placed.png';
    for (const file of [kept, orphan, foreign]) {
      writeFileSync(resolve(outDir, file), 'x');
    }
    const pruned = pruneSnapshotOrphans(outDir, [
      makeEntry({
        srcSet: `/_hero/ogabassey/${kept} 640w`,
        href: `/_hero/ogabassey/${kept}`,
      }),
    ]);

    expect(pruned).toEqual([orphan]);
    expect(existsSync(resolve(outDir, kept))).toBe(true);
    expect(existsSync(resolve(outDir, orphan))).toBe(false);
    expect(existsSync(resolve(outDir, foreign))).toBe(true);
  });
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
        ogabassey: { 'x': makeEntry({ sourceUrl: "o'brien" }) },
      })
    ).toThrow(/breaks manifest serialization/);
  });
});

describe('default paths', () => {
  it('derives webRoot and manifestPath under the repo', () => {
    const webRoot = defaultWebRoot();
    expect(webRoot.endsWith(join('apps', 'web'))).toBe(true);
    expect(defaultManifestPath(webRoot)).toBe(
      resolve(webRoot, 'src/config/ogabassey-home-hero-snapshot-manifest.ts')
    );
  });
});

describe('SNAPSHOT_WIDTHS', () => {
  it('covers the emitted mobile ladder from the 256 floor', () => {
    expect(SNAPSHOT_WIDTHS).toEqual([256, 384, 640, 750, 828, 1080, 1200]);
    expect(Math.min(...SNAPSHOT_WIDTHS)).toBe(256);
  });

  it('keeps managed filenames parseable', () => {
    expect(MANAGED_FILE_PATTERN.test('abcdef012345-640.avif')).toBe(true);
    expect(MANAGED_FILE_PATTERN.test('../x-640.avif')).toBe(false);
  });
});

describe('writeSnapshotManifest', () => {
  it('writes slug entries while preserving other tenants', async () => {
    const webRoot = makeTempWebRoot();
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
        manifestPath: resolve(makeTempWebRoot(), 'missing.ts'),
        root: '/tmp',
        skipBiomeFormat: true,
        slug: 'ogabassey',
        webRoot: '/tmp',
      })
    ).rejects.toThrow(/not found/);
  });
});

describe('runGenerateOgabasseyHeroSnapshots', () => {
  it('runs end to end: bakes, prunes, and writes the manifest', async () => {
    const webRoot = makeTempWebRoot();
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
    const webRoot = makeTempWebRoot();
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
          fetchImpl: async (url) =>
            makeFakeFetch({
              status: String(url).includes('bad.jpg') ? 500 : 200,
            })(url),
          sharpImpl: makeFakeSharp(),
          skipBiomeFormat: true,
          webRoot,
        }
      )
    ).rejects.toThrow(/HTTP 500/);

    expect(readFileSync(manifestPath, 'utf8')).toBe(before);
    expect(existsSync(resolve(outDir, orphan))).toBe(true);
  });
});
