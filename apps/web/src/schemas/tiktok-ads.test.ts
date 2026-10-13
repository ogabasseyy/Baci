import { describe, expect, it } from 'vitest';
import {
  MAX_TIKTOK_ADS_SYNC_DAYS,
  tiktokAdsAccountSelectionSchema,
  tiktokAdsSpendQuerySchema,
  tiktokAdsSyncRequestSchema,
} from './tiktok-ads';

describe('TikTok Ads schemas', () => {
  it('accepts opaque advertiser IDs and enforces the 30-day daily-report limit', () => {
    expect(
      tiktokAdsAccountSelectionSchema.safeParse({ accountId: 'opaque-abc_01' })
        .success
    ).toBe(true);
    expect(
      tiktokAdsAccountSelectionSchema.safeParse({ accountId: 'not an id' })
        .success
    ).toBe(false);
    expect(
      tiktokAdsSyncRequestSchema.safeParse({
        startDate: '2026-08-01',
        endDate: '2026-08-30',
      }).success
    ).toBe(true);
    expect(
      tiktokAdsSyncRequestSchema.safeParse({
        startDate: '2026-08-01',
        endDate: '2026-08-31',
      }).success
    ).toBe(false);
  });

  it('bounds direct spend windows at the provider sync limit', () => {
    expect(
      tiktokAdsSpendQuerySchema.safeParse({
        endDate: '2026-08-30',
        startDate: '2026-08-01',
      }).success
    ).toBe(true);
    expect(
      tiktokAdsSpendQuerySchema.safeParse({
        endDate: '2026-08-31',
        startDate: '2026-08-01',
      }).success
    ).toBe(false);
    expect(MAX_TIKTOK_ADS_SYNC_DAYS).toBe(30);
  });

  it('accepts an ISO timestamp for the shared sync run ordering floor', () => {
    expect(
      tiktokAdsSyncRequestSchema.parse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncRunStartedAt: '2026-08-27T22:00:00.000Z',
      }).syncRunStartedAt
    ).toBe('2026-08-27T22:00:00.000Z');
  });

  it('rejects a run identifier without its ordering timestamp', () => {
    expect(
      tiktokAdsSyncRequestSchema.safeParse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncRunId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
  });

  it('accepts a containing completion window and rejects an unrelated chunk', () => {
    expect(
      tiktokAdsSyncRequestSchema.safeParse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncWindowEndDate: '2026-08-31',
        syncWindowStartDate: '2026-08-01',
      }).success
    ).toBe(true);
    expect(
      tiktokAdsSyncRequestSchema.safeParse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncWindowEndDate: '2026-08-19',
        syncWindowStartDate: '2026-08-01',
      }).success
    ).toBe(false);
  });
});
