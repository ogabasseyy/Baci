import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findCacheHits,
  harUserAgent,
  parseArgs,
  parsePositiveInteger,
  parsePositiveNumber,
  pngCrc32,
  pngDimensions,
  verifyBrowserVersion,
  verifyCacheProvenance,
  verifyHarConnectivity,
  verifyHarIterations,
  verifyScreenshotProvenance,
} from './merchant-image-pilot-settings-helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GENERATOR_FIXTURES = join(
  here,
  '..',
  '..',
  '..',
  '..',
  'infra',
  'cdn-transformer',
  'pilot',
  'fixtures'
);

function fixturePng() {
  return readFile(join(GENERATOR_FIXTURES, 'tiny-48x48.png'));
}

describe('merchant-image-pilot-settings helpers', () => {
  it('reads PNG dimensions from a fully validated file', async () => {
    expect(pngDimensions(await fixturePng())).toEqual({
      height: 48,
      width: 48,
    });
    expect(() => pngDimensions(Buffer.alloc(33, 0))).toThrow('not a PNG');
  });

  it('rejects truncated, corrupted, and padded screenshots', async () => {
    const full = await fixturePng();
    // Header-only bytes must not pass on IHDR alone.
    expect(() => pngDimensions(full.subarray(0, 24))).toThrow(
      'PNG is truncated'
    );
    expect(() => pngDimensions(full.subarray(0, full.length - 10))).toThrow(
      'PNG is truncated'
    );
    // A single flipped IDAT byte breaks the chunk CRC.
    const corrupted = Buffer.from(full);
    corrupted[corrupted.length - 20] ^= 0xff;
    expect(() => pngDimensions(corrupted)).toThrow(/failed its CRC check/);
    // Trailing garbage after IEND is not a clean artifact.
    expect(() =>
      pngDimensions(Buffer.concat([full, Buffer.from([0])]))
    ).toThrow('trailing bytes after IEND');
  });

  it('rejects pixel-less and zero-dimension PNGs with valid CRCs', () => {
    const chunk = (type, data) => {
      const body = Buffer.concat([
        Buffer.from(type, 'latin1'),
        Buffer.from(data),
      ]);
      const head = Buffer.alloc(4);
      head.writeUInt32BE(data.length, 0);
      const crc = Buffer.alloc(4);
      crc.writeUInt32BE(pngCrc32(body, 0, body.length), 0);
      return Buffer.concat([head, body, crc]);
    };
    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const ihdr = (width, height) => {
      const data = Buffer.alloc(13);
      data.writeUInt32BE(width, 0);
      data.writeUInt32BE(height, 4);
      data[8] = 8;
      data[9] = 2;
      return chunk('IHDR', data);
    };
    const iend = chunk('IEND', []);
    // Valid IHDR + valid IEND but no IDAT: structurally sound, zero pixels.
    expect(() =>
      pngDimensions(Buffer.concat([signature, ihdr(48, 48), iend]))
    ).toThrow('no image data (IDAT)');
    // Zero width/height with a VALID IHDR CRC: the dims check must fire,
    // not the CRC check.
    expect(() =>
      pngDimensions(Buffer.concat([signature, ihdr(0, 48), iend]))
    ).toThrow('dimensions must be positive');
    expect(() =>
      pngDimensions(Buffer.concat([signature, ihdr(48, 0), iend]))
    ).toThrow('dimensions must be positive');
  });

  it('extracts the browser UA from the first HAR entry', () => {
    const ua = 'Mozilla/5.0 Chrome/154.0.0.0 Mobile Safari/537.36';
    expect(
      harUserAgent({
        log: {
          entries: [
            { request: { headers: [{ name: 'User-Agent', value: ua }] } },
          ],
        },
      })
    ).toBe(ua);
    expect(harUserAgent({ log: { entries: [] } })).toBe(null);
  });

  it('rejects non-positive numbers instead of passing geometry', () => {
    // NaN comparisons are all false, so an unvalidated DPR would pass
    // har.geometry on any screenshot.
    expect(parsePositiveNumber('2', 'expect-dpr')).toBe(2);
    expect(parsePositiveNumber('1.75', 'expect-dpr')).toBe(1.75);
    for (const bad of ['abc', '', '0', '-2', 'NaN', 'Infinity']) {
      expect(() => parsePositiveNumber(bad, 'expect-dpr')).toThrow(
        /bad --expect-dpr/
      );
    }
  });

  it('requires a positive integer iteration count', () => {
    // --expect-iterations=0 would let an empty HAR pass the iteration
    // and connectivity checks vacuously.
    expect(parsePositiveInteger('2', 'expect-iterations')).toBe(2);
    for (const bad of ['0', '-1', '1.5', 'abc', '', 'NaN']) {
      expect(() => parsePositiveInteger(bad, 'expect-iterations')).toThrow(
        /bad --expect-iterations/
      );
    }
  });

  it('shares the strict settings CLI allowlist', () => {
    expect(parseArgs(['--har=a.har', '--expect-dpr=2'])).toEqual({
      'expect-dpr': '2',
      har: 'a.har',
    });
    expect(() => parseArgs(['--origin=https://x'])).toThrow(
      /unknown option --origin/
    );
    expect(() => parseArgs(['--har'])).toThrow(/expected --key=value/);
  });

  it('classifies cache hits without misclassifying plain entries', () => {
    const har = {
      log: {
        entries: [
          { response: { status: 200 } },
          { response: { status: 204 } },
          { response: { fromDiskCache: true, status: 200 } },
          { response: { status: 304 } },
        ],
      },
    };
    expect(findCacheHits(har)).toHaveLength(2);
    expect(findCacheHits({ log: { entries: [] } })).toEqual([]);
  });

  it('checks iteration counts and connectivity labels', () => {
    const pages = [{ _meta: { connectivity: 'native' } }];
    expect(verifyHarIterations(pages, 1)).toEqual({ ok: true });
    expect(verifyHarIterations(pages, 2).ok).toBe(false);
    expect(verifyHarConnectivity(pages, 'native')).toEqual({ ok: true });
    expect(verifyHarConnectivity(pages, '4G').error).toMatch(
      /recorded native, expected 4G/
    );
  });

  it('checks attested browser builds against the expected major', () => {
    expect(verifyBrowserVersion('154.0.0.0', '154')).toEqual({ ok: true });
    expect(verifyBrowserVersion('153.0.0.0', '154').error).toMatch(
      /does not match Chrome 154/
    );
    expect(verifyBrowserVersion('debian-chromium', '154').error).toMatch(
      /not a dotted browser build/
    );
  });

  it('binds cache provenance to a fresh runner reset before the run', () => {
    const pages = [
      {
        _meta: { runId: 'run-navigation-1' },
        startedDateTime: '2026-10-04T00:10:00.000Z',
      },
    ];
    const valid = JSON.stringify({
      event: 'profile-reset',
      freshProfile: true,
      profileDir: '/tmp/run/profile',
      resetAt: '2026-10-04T00:09:00.000Z',
      runId: 'run-navigation-1',
      tool: 'browsertime',
    });
    expect(verifyCacheProvenance(valid, pages)).toEqual({
      ok: true,
      summary: 'browsertime@2026-10-04T00:09:00.000Z',
    });
    expect(verifyCacheProvenance(valid, [...pages, ...pages]).error).toMatch(
      /exactly one HAR iteration/
    );
    expect(verifyCacheProvenance(valid, [...pages, {}]).ok).toBe(false);
    // Unreadable, malformed, and misshapen artifacts fail closed.
    expect(verifyCacheProvenance(null, pages, 'missing.json').error).toMatch(
      /cannot read/
    );
    expect(verifyCacheProvenance('{nope', pages).error).toMatch(
      /not valid JSON/
    );
    for (const [label, patch] of [
      ['event', { event: 'run-start' }],
      ['fresh', { freshProfile: false }],
      ['dir', { profileDir: '' }],
      ['tool', { tool: '' }],
      ['run', { runId: '' }],
      ['run-long', { runId: 'r'.repeat(129) }],
      ['time', { resetAt: 'yesterday' }],
    ]) {
      const broken = JSON.stringify({ ...JSON.parse(valid), ...patch });
      expect(verifyCacheProvenance(broken, pages).ok, label).toBe(false);
    }
    // A bare caller string is not a runner artifact.
    expect(verifyCacheProvenance('"just-a-token"', pages).ok).toBe(false);
    // Stale and post-run resets prove nothing about this run.
    const stale = JSON.stringify({
      ...JSON.parse(valid),
      resetAt: '2026-10-03T22:00:00.000Z',
    });
    expect(verifyCacheProvenance(stale, pages).error).toMatch(/stale/);
    const postdated = JSON.stringify({
      ...JSON.parse(valid),
      resetAt: '2026-10-04T00:11:00.000Z',
    });
    expect(verifyCacheProvenance(postdated, pages).error).toMatch(/postdates/);
    // Undated HAR pages cannot bind the reset to the run.
    expect(
      verifyCacheProvenance(valid, [{ _meta: { runId: 'run-navigation-1' } }])
        .error
    ).toMatch(/no startedDateTime/);
    // One reset certifies exactly one navigation: a reused artifact
    // against a second single-page HAR (different runId) fails, as does
    // a page that carries no runId at all.
    expect(
      verifyCacheProvenance(valid, [
        {
          _meta: { runId: 'run-navigation-2' },
          startedDateTime: '2026-10-04T00:10:00.000Z',
        },
      ]).error
    ).toMatch(/does not match the measured navigation/);
    expect(verifyCacheProvenance(valid, [{}]).error).toMatch(/no _meta\.runId/);
  });

  it('binds screenshot bytes to the measured HAR navigation', async () => {
    const pages = [
      {
        _meta: { runId: 'run-navigation-1' },
        startedDateTime: '2026-10-04T00:10:00.000Z',
      },
    ];
    const shot = await fixturePng();
    const sha = createHash('sha256').update(shot).digest('hex');
    const valid = JSON.stringify({
      capturedAt: '2026-10-04T00:10:30.000Z',
      event: 'screenshot-capture',
      runId: 'run-navigation-1',
      screenshotSha256: sha,
      tool: 'browsertime',
    });
    expect(verifyScreenshotProvenance(valid, pages, shot, 'shot.json')).toEqual(
      {
        ok: true,
        summary: 'browsertime@2026-10-04T00:10:30.000Z',
      }
    );
    expect(
      verifyScreenshotProvenance(valid, [...pages, ...pages], shot, 'shot.json')
        .error
    ).toMatch(/exactly one HAR iteration/);
    // Unreadable, malformed, and misshapen artifacts fail closed.
    expect(
      verifyScreenshotProvenance(null, pages, shot, 'missing.json').error
    ).toMatch(/cannot read/);
    expect(
      verifyScreenshotProvenance('{nope', pages, shot, 'shot.json').error
    ).toMatch(/not valid JSON/);
    for (const [label, patch] of [
      ['event', { event: 'profile-reset' }],
      ['tool', { tool: '' }],
      ['run', { runId: '' }],
      ['run-long', { runId: 'r'.repeat(129) }],
      ['sha', { screenshotSha256: 'zz' }],
      ['time', { capturedAt: 'yesterday' }],
    ]) {
      const broken = JSON.stringify({ ...JSON.parse(valid), ...patch });
      expect(
        verifyScreenshotProvenance(broken, pages, shot, 'shot.json').ok,
        label
      ).toBe(false);
    }
    // A stale screenshot from another iteration cannot certify this HAR:
    // different bytes fail the hash, a foreign runId fails the binding.
    const other = Buffer.from('not the measured screenshot');
    expect(
      verifyScreenshotProvenance(valid, pages, other, 'shot.json').error
    ).toMatch(/does not match the supplied screenshot bytes/);
    expect(
      verifyScreenshotProvenance(
        valid,
        [
          {
            _meta: { runId: 'run-navigation-2' },
            startedDateTime: '2026-10-04T00:10:00.000Z',
          },
        ],
        shot,
        'shot.json'
      ).error
    ).toMatch(/does not match the measured navigation/);
    expect(
      verifyScreenshotProvenance(valid, [{}], shot, 'shot.json').error
    ).toMatch(/no _meta\.runId/);
    // Captures outside the navigation window prove nothing about it.
    const predated = JSON.stringify({
      ...JSON.parse(valid),
      capturedAt: '2026-10-04T00:09:00.000Z',
    });
    expect(
      verifyScreenshotProvenance(predated, pages, shot, 'shot.json').error
    ).toMatch(/predates/);
    const stale = JSON.stringify({
      ...JSON.parse(valid),
      capturedAt: '2026-10-04T02:30:00.000Z',
    });
    expect(
      verifyScreenshotProvenance(stale, pages, shot, 'shot.json').error
    ).toMatch(/stale/);
    expect(
      verifyScreenshotProvenance(
        valid,
        [{ _meta: { runId: 'run-navigation-1' } }],
        shot,
        'shot.json'
      ).error
    ).toMatch(/no startedDateTime/);
  });
});
