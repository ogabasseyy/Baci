import { describe, expect, it } from 'vitest';
import {
  escapeCSVField,
  formatAnalyticsExportPeriod,
  getAnalyticsExportCategoryLabel,
} from './analytics-export-formatters';

describe('analytics export formatters', () => {
  it('labels lifetime segments independently from the selected date range', () => {
    expect(
      formatAnalyticsExportPeriod('segments', {
        from: new Date('2026-08-01T00:00:00.000Z'),
        to: new Date('2026-08-07T00:00:00.000Z'),
      })
    ).toBe('Lifetime');
    expect(getAnalyticsExportCategoryLabel('segments')).toBe(
      'Customer Segments'
    );
  });

  it('escapes CSV formulas and embedded quotes', () => {
    expect(escapeCSVField('=SUM(A1:A2)')).toBe('"\'=SUM(A1:A2)"');
    expect(escapeCSVField('Merchant "Baci"')).toBe('"Merchant ""Baci"""');
  });
});
