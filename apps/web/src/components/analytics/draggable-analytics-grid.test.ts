import { describe, expect, it } from 'vitest';

import { formatTopProductUnits } from './draggable-analytics-grid';

describe('DraggableAnalyticsGrid top-product metrics', () => {
  it('renders the canonical units field for top products', () => {
    expect(formatTopProductUnits(7)).toBe('7 units sold');
    expect(formatTopProductUnits(undefined)).toBe('0 units sold');
  });
});
