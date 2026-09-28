import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bakeSnapshots,
  pruneSnapshotOrphans,
} from './ogabassey-hero-snapshot-bake.mjs';
import {
  DEFAULT_WIDTH,
  SNAPSHOT_QUALITY,
  SNAPSHOT_WIDTHS,
} from './ogabassey-hero-snapshot-config.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';

function makeFakeFetch() {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    url: SOURCE_URL,
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => Buffer.from('fake-source-bytes'),
  }));
}

// Faithful-enough sharp double: metadata reports the source width for
// buffers and parses the baked width back out of managed filenames.
function makeFakeSharp({
  bakedWidth = null,
  calls = null,
  encodeTag = 'v1',
  sourceWidth = 1600,
} = {}) {
  return (input) => {
    const chain = {
      _width: null,
      rotate() {
        calls?.push('rotate');
        return chain;
      },
      resize({ width }) {
        calls?.push('resize');
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
});

describe('bakeSnapshots', () => {
  it('bakes the full width ladder with encoded-hash names', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
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
      expect(entry.srcSet).toContain(
        `/_hero/ogabassey/${expected}-${width}.avif ${width}w`
      );
      expect(existsSync(resolve(outDir, `${expected}-${width}.avif`))).toBe(true);
    }
    // Preload href is the nearest-to-960 file.
    const hrefWidth = [...SNAPSHOT_WIDTHS].sort(
      (a, b) => Math.abs(a - DEFAULT_WIDTH) - Math.abs(b - DEFAULT_WIDTH)
    )[0];
    expect(entry.srcSet).toContain(entry.href);
    expect(entry.href.endsWith(`-${hrefWidth}.avif`)).toBe(true);
  });

  it('auto-orients before resizing every width', async () => {
    const calls = [];
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    await bakeSnapshots({
      fetchImpl: makeFakeFetch(),
      outDir,
      sharpImpl: makeFakeSharp({ calls }),
      slug: 'ogabassey',
      urls: [SOURCE_URL],
    });

    expect(calls).toHaveLength(SNAPSHOT_WIDTHS.length * 2);
    for (let i = 0; i < calls.length; i += 2) {
      expect([calls[i], calls[i + 1]]).toEqual(['rotate', 'resize']);
    }
  });

  it('refuses to upscale a source narrower than the widest snapshot', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
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
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
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
        outDir: resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey'),
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
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-prune-')), 'ogabassey');
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
