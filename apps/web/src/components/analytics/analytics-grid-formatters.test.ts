import { describe, expect, it } from 'vitest';
import {
  createAnalyticsFormatters,
  formatTopProductUnits,
} from './analytics-grid-formatters';

describe('analytics grid formatters', () => {
  it('formats merchant currency and product units', () => {
    const { formatCurrency, formatPercent } = createAnalyticsFormatters({
      country: 'NG',
    } as never);

    expect(formatCurrency(2500)).toContain('2,500');
    expect(formatPercent(12.5)).toBe('12.5%');
    expect(formatTopProductUnits(undefined)).toBe('0 units sold');
  });
});
