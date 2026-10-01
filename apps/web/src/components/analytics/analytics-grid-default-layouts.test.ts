import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUTS } from './analytics-grid-default-layouts';

describe('analytics grid default layouts', () => {
  it('provides the ad reporting widgets at every responsive breakpoint', () => {
    for (const breakpoint of ['lg', 'md', 'sm', 'xs', 'xxs'] as const) {
      const ids = new Set(DEFAULT_LAYOUTS[breakpoint].map((item) => item.i));
      expect(ids.has('ads-reporting')).toBe(true);
      expect(ids.has('social-ads-reporting')).toBe(true);
    }
  });
});
