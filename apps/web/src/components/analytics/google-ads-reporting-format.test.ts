import { describe, expect, it } from 'vitest';
import {
  formatGoogleAdsMetric,
  formatGoogleAdsReportingWindow,
} from './google-ads-reporting-format';

describe('Google Ads reporting formatting', () => {
  it('formats currency, counts, percentages, and reporting windows', () => {
    expect(formatGoogleAdsMetric(1234.5, 'currency', 'USD')).toBe('$1,234.50');
    expect(formatGoogleAdsMetric(1.234, 'currency', 'KWD')).toContain('1.234');
    expect(formatGoogleAdsMetric(1234.5, 'number', 'USD')).toBe('1,235');
    expect(formatGoogleAdsMetric(0.4, 'conversion', 'USD')).toBe('0.4');
    expect(formatGoogleAdsMetric(2.345, 'percent', 'USD')).toBe('2.35%');
    expect(
      formatGoogleAdsReportingWindow({
        endDate: '2026-08-20',
        startDate: '2026-08-01',
      })
    ).toBe('2026-08-01 – 2026-08-20');
  });

  it('omits a reporting window when either boundary is absent', () => {
    expect(formatGoogleAdsReportingWindow({ startDate: '2026-08-01' })).toBe(
      null
    );
  });
});
