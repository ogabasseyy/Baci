import { describe, expect, it } from 'vitest';
import {
  harUserAgent,
  parseArgs,
  parsePositiveNumber,
  pngDimensions,
} from './merchant-image-pilot-settings-helpers.mjs';

function pngBuffer(width, height) {
  const buffer = Buffer.alloc(33, 0);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

describe('merchant-image-pilot-settings helpers', () => {
  it('reads PNG dimensions from IHDR without image deps', () => {
    expect(pngDimensions(pngBuffer(1125, 2000))).toEqual({
      height: 2000,
      width: 1125,
    });
    expect(() => pngDimensions(Buffer.alloc(33, 0))).toThrow('not a PNG');
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
