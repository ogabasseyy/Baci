import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSnapshotFreshness } from './ogabassey-hero-snapshot-check.mjs';

const SOURCE_URL = 'https://cdn.ogabassey.com/core-assets/products/dell.jpg';
const OTHER_URL = 'https://cdn.ogabassey.com/core-assets/products/other.jpg';

function makeFakeFetch(bytesByUrl) {
  return vi.fn(async (url) => ({
    ok: true,
    status: 200,
    url: String(url),
    headers: { get: () => 'image/jpeg' },
    arrayBuffer: async () => bytesByUrl[String(url)] ?? Buffer.from('x'),
  }));
}

function seedManifestFile(webRoot, entries, bakedAtByUrl = {}) {
  const dir = resolve(webRoot, 'src/config');
  mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, 'ogabassey-hero-snapshot-manifest.ts');
  const body = Object.entries(entries)
    .map(([url, sha]) => {
      const bakedAt =
        url in bakedAtByUrl ? bakedAtByUrl[url] : new Date().toISOString();
      const bakedAtLine =
        bakedAt === null ? '' : `\n      bakedAt: '${bakedAt}',`;
      return (
        `    '${url}': {\n      sourceUrl: '${url}',\n      sourceSha256: '${sha}',` +
        `${bakedAtLine}\n    },`
      );
    })
    .join('\n');
  writeFileSync(
    manifestPath,
    `export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST_VERSION = 1;\n\n` +
      `export const OGABASSEY_HOME_HERO_SNAPSHOT_MANIFEST: Record<string, Record<string, object>> = ` +
      `{\n  ogabassey: {\n${body}\n  },\n};\n`
  );
  return manifestPath;
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('checkSnapshotFreshness', () => {
  it('passes when every kept source matches its recorded hash', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-check-'));
    const manifestPath = seedManifestFile(webRoot, {
      [SOURCE_URL]: sha('bytes-v1'),
      [OTHER_URL]: sha('other-bytes'),
    });
    const { checked, drifted } = await checkSnapshotFreshness({
      fetchImpl: makeFakeFetch({
        [SOURCE_URL]: Buffer.from('bytes-v1'),
        [OTHER_URL]: Buffer.from('other-bytes'),
      }),
      manifestPath,
      slug: 'ogabassey',
      urls: [],
    });

    expect(drifted).toEqual([]);
    expect(checked).toEqual([OTHER_URL, SOURCE_URL].sort());
  });

  it('fails loudly on an in-place source overwrite', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-check-'));
    const manifestPath = seedManifestFile(webRoot, {
      [SOURCE_URL]: sha('bytes-v1'),
    });
    await expect(
      checkSnapshotFreshness({
        fetchImpl: makeFakeFetch({
          [SOURCE_URL]: Buffer.from('bytes-v2-overwritten'),
        }),
        manifestPath,
        slug: 'ogabassey',
        urls: [],
      })
    ).rejects.toThrow(new RegExp(`drift.*${SOURCE_URL}`));
  });

  it('checks only the requested subset when urls are given', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-check-'));
    const manifestPath = seedManifestFile(webRoot, {
      [SOURCE_URL]: sha('bytes-v1'),
      [OTHER_URL]: sha('other-bytes'),
    });
    const fetchImpl = makeFakeFetch({
      [SOURCE_URL]: Buffer.from('bytes-v1'),
      [OTHER_URL]: Buffer.from('CHANGED'),
    });
    const { checked } = await checkSnapshotFreshness({
      fetchImpl,
      manifestPath,
      slug: 'ogabassey',
      urls: [SOURCE_URL],
    });

    expect(checked).toEqual([SOURCE_URL]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails on entries older than the re-bake cadence without fetching', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-check-'));
    const manifestPath = seedManifestFile(
      webRoot,
      { [SOURCE_URL]: sha('bytes-v1') },
      {
        [SOURCE_URL]: new Date(
          Date.now() - 31 * 24 * 60 * 60 * 1000
        ).toISOString(),
      }
    );
    const fetchImpl = makeFakeFetch({
      [SOURCE_URL]: Buffer.from('bytes-v1'),
    });
    await expect(
      checkSnapshotFreshness({
        fetchImpl,
        manifestPath,
        slug: 'ogabassey',
        urls: [],
      })
    ).rejects.toThrow(new RegExp(`expired.*re-bake.*${SOURCE_URL}`));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails on entries with a missing bakedAt', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-check-'));
    const manifestPath = seedManifestFile(
      webRoot,
      { [SOURCE_URL]: sha('bytes-v1') },
      { [SOURCE_URL]: null }
    );
    await expect(
      checkSnapshotFreshness({
        fetchImpl: makeFakeFetch({}),
        manifestPath,
        slug: 'ogabassey',
        urls: [],
      })
    ).rejects.toThrow(/no parseable bakedAt/);
  });

  it('rejects unknown slugs and unkept urls', async () => {
    const webRoot = mkdtempSync(join(tmpdir(), 'hero-check-'));
    const manifestPath = seedManifestFile(webRoot, {
      [SOURCE_URL]: sha('bytes-v1'),
    });
    await expect(
      checkSnapshotFreshness({
        fetchImpl: makeFakeFetch({}),
        manifestPath,
        slug: 'nope',
        urls: [],
      })
    ).rejects.toThrow(/no entries for slug/);
    await expect(
      checkSnapshotFreshness({
        fetchImpl: makeFakeFetch({}),
        manifestPath,
        slug: 'ogabassey',
        urls: ['https://cdn.ogabassey.com/unkept.jpg'],
      })
    ).rejects.toThrow(/no entry for/);
  });
});
