import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  harUserAgent,
  parseArgs,
  parsePositiveInteger,
  parsePositiveNumber,
  pngDimensions,
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
});
