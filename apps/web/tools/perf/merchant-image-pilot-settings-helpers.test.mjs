import { describe, expect, it } from 'vitest';
import { parseDimensions } from './merchant-image-pilot-settings-helpers.mjs';

describe('merchant-image-pilot-settings-helpers', () => {
  it('requires positive viewport axes, never zero', () => {
    expect(parseDimensions('375x667', 'expect-viewport')).toEqual({
      height: 667,
      width: 375,
    });
    for (const bad of ['0x0', '0x667', '375x0', 'axb', '', '375']) {
      expect(() => parseDimensions(bad, 'expect-viewport')).toThrow(
        /bad --expect-viewport/
      );
    }
  });
});
