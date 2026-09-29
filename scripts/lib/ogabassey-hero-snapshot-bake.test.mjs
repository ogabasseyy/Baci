import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bakeSnapshots } from './ogabassey-hero-snapshot-bake.mjs';
import {
  DEFAULT_WIDTH,
  SNAPSHOT_QUALITY,
  SNAPSHOT_WIDTHS,
} from './ogabassey-hero-snapshot-config.mjs';
import {
  FAKE_BAKE_SOURCE_URL,
  makeFakeBakeFetch,
  makeFakeSharp,
} from './ogabassey-hero-snapshot-bake.test-fixture.mjs';

const SOURCE_URL = FAKE_BAKE_SOURCE_URL;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('bakeSnapshots', () => {
  it('bakes the full width ladder with encoded-hash names', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    const { entries } = await bakeSnapshots({
      fetchImpl: makeFakeBakeFetch(),
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
      fetchImpl: makeFakeBakeFetch(),
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
        fetchImpl: makeFakeBakeFetch(),
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
      fetchImpl: makeFakeBakeFetch(),
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
        fetchImpl: makeFakeBakeFetch(),
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

  it('rejects a baked file whose dimensions do not match', async () => {
    const outDir = resolve(mkdtempSync(join(tmpdir(), 'hero-bake-')), 'ogabassey');
    await expect(
      bakeSnapshots({
        fetchImpl: makeFakeBakeFetch(),
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
          fetchImpl: makeFakeBakeFetch(),
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
