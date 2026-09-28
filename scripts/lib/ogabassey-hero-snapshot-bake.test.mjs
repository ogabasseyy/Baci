import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bakeSnapshots } from './ogabassey-hero-snapshot-bake.mjs';
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
  orientation = undefined,
  sourceHeight = 1600,
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
          return {
            width: sourceWidth,
            height: sourceHeight,
            format: 'jpeg',
            orientation,
          };
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

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('bakeSnapshots', () => {
  it('bakes the full width ladder with encoded-hash names', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    const { entries } = await bakeSnapshots({
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
    expect(Number.isFinite(Date.parse(entry.bakedAt))).toBe(true);
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

  it('validates the auto-oriented width for EXIF-rotated sources', async () => {
    // Stored 900x1600, displayed 1600x900 after .rotate(): must pass.
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    const { entries } = await bakeSnapshots({
      fetchImpl: makeFakeFetch(),
      outDir,
      sharpImpl: makeFakeSharp({
        orientation: 6,
        sourceHeight: 1600,
        sourceWidth: 900,
      }),
      slug: 'ogabassey',
      urls: [SOURCE_URL],
    });
    expect(entries).toHaveLength(1);
  });

  it('still rejects an EXIF-rotated source narrower than 1200 when oriented', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    await expect(
      bakeSnapshots({
        fetchImpl: makeFakeFetch(),
        outDir,
        sharpImpl: makeFakeSharp({
          orientation: 8,
          sourceHeight: 1000,
          sourceWidth: 700,
        }),
        slug: 'ogabassey',
        urls: [SOURCE_URL],
      })
    ).rejects.toThrow(/1000px wide/);
  });

  it('rolls back earlier urls when a later one fails', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    const failingFetch = vi.fn(async (url) => ({
      ok: !String(url).includes('bad.jpg'),
      status: String(url).includes('bad.jpg') ? 500 : 200,
      url: String(url),
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from('fake-source-bytes'),
    }));
    await expect(
      bakeSnapshots({
        fetchImpl: failingFetch,
        outDir,
        sharpImpl: makeFakeSharp(),
        slug: 'ogabassey',
        urls: [SOURCE_URL, 'https://cdn.ogabassey.com/bad.jpg'],
      })
    ).rejects.toThrow(/HTTP 500/);
    expect(readdirSync(outDir)).toEqual([]);
  });

  it('preserves pre-existing files when rolling back', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    // Regeneration rewrites identical bytes (content hash); the committed
    // file must survive a later-url failure, not join the rollback set.
    const committedName = `${createHash('sha256').update('fake-avif-v1-256').digest('hex').slice(0, 12)}-256.avif`;
    writeFileSync(resolve(outDir, committedName), 'fake-avif-v1-256');
    const failingFetch = vi.fn(async (url) => ({
      ok: !String(url).includes('bad.jpg'),
      status: String(url).includes('bad.jpg') ? 500 : 200,
      url: String(url),
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => Buffer.from('fake-source-bytes'),
    }));
    await expect(
      bakeSnapshots({
        fetchImpl: failingFetch,
        outDir,
        sharpImpl: makeFakeSharp(),
        slug: 'ogabassey',
        urls: [SOURCE_URL, 'https://cdn.ogabassey.com/bad.jpg'],
      })
    ).rejects.toThrow(/HTTP 500/);

    expect(readdirSync(outDir)).toEqual([committedName]);
    expect(readFileSync(resolve(outDir, committedName), 'utf8')).toBe(
      'fake-avif-v1-256'
    );
  });

  it('leaves no partial or temp files when the asset write fails', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    // A committed asset the old manifest still references: the failed run
    // must neither truncate it nor leave a partial/temp sibling behind.
    const committedName = 'committed-asset-640.avif';
    writeFileSync(resolve(outDir, committedName), 'committed-bytes');
    // Fail the atomic replacement deterministically (and as any user): a
    // directory at the destination path makes the temp→final rename throw
    // after the temp write succeeded, exercising the same catch block as a
    // mid-write ENOSPC.
    const firstName = `${createHash('sha256').update('fake-avif-v1-256').digest('hex').slice(0, 12)}-256.avif`;
    mkdirSync(resolve(outDir, firstName));
    await expect(
      bakeSnapshots({
        fetchImpl: makeFakeFetch(),
        outDir,
        sharpImpl: makeFakeSharp(),
        slug: 'ogabassey',
        urls: [SOURCE_URL],
      })
    ).rejects.toThrow();
    expect(readdirSync(outDir).sort()).toEqual(
      [committedName, firstName].sort()
    );
    expect(
      readdirSync(outDir).some((name) => name.includes('.tmp-'))
    ).toBe(false);
    expect(readFileSync(resolve(outDir, committedName), 'utf8')).toBe(
      'committed-bytes'
    );
  });

  it('sweeps stale temp siblings from a killed run before baking', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, 'abc123-640.avif.tmp-99999999'), 'partial');
    await bakeSnapshots({
      fetchImpl: makeFakeFetch(),
      outDir,
      sharpImpl: makeFakeSharp(),
      slug: 'ogabassey',
      urls: [SOURCE_URL],
    });
    expect(
      readdirSync(outDir).some((name) => name.includes('.tmp-'))
    ).toBe(false);
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
    const bake = async (encodeTag) =>
      (
        await bakeSnapshots({
          fetchImpl: makeFakeFetch(),
          outDir: resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey'),
          sharpImpl: makeFakeSharp({ encodeTag }),
          slug: 'ogabassey',
          urls: [SOURCE_URL],
        })
      ).entries;
    const [before] = await bake('v1');
    const [after] = await bake('v2-quality-bump');
    expect(after.srcSet).not.toBe(before.srcSet);

    const [repeat] = await bake('v1');
    expect(repeat.srcSet).toBe(before.srcSet);
    expect(repeat.href).toBe(before.href);
  });
});
