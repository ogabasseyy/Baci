import { describe, expect, it } from 'vitest';
import {
  ADS_ANALYTICS_MAX_DAYS,
  ADS_SYNC_MAX_DAYS,
  getInclusiveAdsDateRangeDays,
} from './ads-sync-limits';

describe('ADS_SYNC_MAX_DAYS', () => {
  it('keeps provider limits aligned with their API windows', () => {
    expect(ADS_SYNC_MAX_DAYS).toEqual({
      google_ads: 90,
      meta_ads: 31,
      snapchat_ads: 366,
      tiktok_ads: 30,
    });
  });

  it('contains exactly one limit for each supported ads provider', () => {
    expect(Object.keys(ADS_SYNC_MAX_DAYS).sort()).toEqual([
      'google_ads',
      'meta_ads',
      'snapchat_ads',
      'tiktok_ads',
    ]);
  });

  it('bounds dashboard reporting to one inclusive leap-year window', () => {
    expect(ADS_ANALYTICS_MAX_DAYS).toBe(366);
  });

  it('counts date-only windows in UTC across leap-day boundaries', () => {
    expect(getInclusiveAdsDateRangeDays('2024-01-01', '2024-12-31')).toBe(366);
    expect(getInclusiveAdsDateRangeDays('2026-01-01', '2026-01-01')).toBe(1);
  });
});
