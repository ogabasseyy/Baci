import { describe, expect, it } from 'vitest';
import {
  googleAdsOAuthCallbackQuerySchema,
  googleAdsSpendQuerySchema,
  googleAdsSyncRequestSchema,
  MAX_GOOGLE_ADS_SYNC_DAYS,
} from './google-ads';

describe('Google Ads schemas', () => {
  it('normalizes a hyphenated customer id', () => {
    expect(
      googleAdsSpendQuerySchema.parse({ customerId: '123-456-7890' })
    ).toMatchObject({ customerId: '1234567890' });
  });

  it('rejects an inverted date range', () => {
    expect(() =>
      googleAdsSpendQuerySchema.parse({
        endDate: '2026-08-01',
        startDate: '2026-08-02',
      })
    ).toThrow();
  });

  it('accepts a provider error callback without exposing extra query fields', () => {
    expect(
      googleAdsOAuthCallbackQuerySchema.parse({ error: 'access_denied' })
    ).toEqual({ error: 'access_denied' });
  });

  it('rejects sync windows longer than 90 days', () => {
    expect(() =>
      googleAdsSyncRequestSchema.parse({
        endDate: '2026-08-21',
        startDate: '2026-01-01',
      })
    ).toThrow();
  });

  it('accepts an ISO timestamp for the shared sync run ordering floor', () => {
    expect(
      googleAdsSyncRequestSchema.parse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncRunStartedAt: '2026-08-27T22:00:00.000Z',
      }).syncRunStartedAt
    ).toBe('2026-08-27T22:00:00.000Z');
  });

  it('rejects a run identifier without its ordering timestamp', () => {
    expect(
      googleAdsSyncRequestSchema.safeParse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncRunId: '00000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
  });

  it('accepts a containing completion window and rejects an unrelated chunk', () => {
    expect(
      googleAdsSyncRequestSchema.safeParse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncWindowEndDate: '2026-08-31',
        syncWindowStartDate: '2026-08-01',
      }).success
    ).toBe(true);
    expect(
      googleAdsSyncRequestSchema.safeParse({
        endDate: '2026-08-21',
        startDate: '2026-08-20',
        syncWindowEndDate: '2026-08-19',
        syncWindowStartDate: '2026-08-01',
      }).success
    ).toBe(false);
  });

  it('bounds direct spend windows at the provider sync limit', () => {
    expect(
      googleAdsSpendQuerySchema.safeParse({
        endDate: '2026-03-31',
        startDate: '2026-01-01',
      }).success
    ).toBe(true);
    expect(
      googleAdsSpendQuerySchema.safeParse({
        endDate: '2026-04-01',
        startDate: '2026-01-01',
      }).success
    ).toBe(false);
    expect(MAX_GOOGLE_ADS_SYNC_DAYS).toBe(90);
  });
});
