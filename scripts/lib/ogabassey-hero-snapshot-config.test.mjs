import { describe, expect, it } from 'vitest';
import {
  MANAGED_FILE_PATTERN,
  SNAPSHOT_WIDTHS,
} from './ogabassey-hero-snapshot-config.mjs';

describe('SNAPSHOT_WIDTHS', () => {
  it('covers the emitted mobile ladder from the 256 floor', () => {
    // Mirrors next/image getWidths for the 40vw hero (allSizes >= 256);
    // tiers >= 1440 are unreachable under the 767px media cap.
    expect(SNAPSHOT_WIDTHS).toEqual([256, 384, 640, 750, 828, 1080, 1200]);
    expect(Math.min(...SNAPSHOT_WIDTHS)).toBe(256);
  });
});

describe('MANAGED_FILE_PATTERN', () => {
  it('matches pipeline-written files only', () => {
    expect(MANAGED_FILE_PATTERN.test('abcdef012345-640.avif')).toBe(true);
    expect(MANAGED_FILE_PATTERN.test('../x-640.avif')).toBe(false);
    expect(MANAGED_FILE_PATTERN.test('hand-placed.png')).toBe(false);
  });
});
