import { describe, expect, it } from 'vitest';
import { adsAnalyticsQuerySchema } from './ads-analytics-query';

describe('adsAnalyticsQuerySchema', () => {
  it('accepts a complete calendar-date reporting window', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22',
        startDate: '2026-08-01',
      }).success
    ).toBe(true);
  });

  it('accepts exact order instants alongside calendar provider dates', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22',
        orderEnd: '2026-08-22T18:30:00.000Z',
        orderStart: '2026-08-01T18:30:00.000Z',
        startDate: '2026-08-01',
      }).success
    ).toBe(true);
  });

  it('accepts an order-only exact reporting window', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        orderEnd: '2026-08-22T18:30:00.000Z',
        orderStart: '2026-08-01T18:30:00.000Z',
      }).success
    ).toBe(true);
  });

  it('accepts exact order instants with a non-UTC offset', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22',
        orderEnd: '2026-08-22T18:30:00+05:30',
        orderStart: '2026-08-01T18:30:00+05:30',
        startDate: '2026-08-01',
      }).success
    ).toBe(true);
  });

  it('accepts a 366-day New York window after local instants are serialized to UTC', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-11-01',
        // America/New_York: local 2025-11-01 00:00 through local
        // 2026-11-01 23:59:59.999 crosses the fall-back transition and
        // serializes to a UTC date range with one extra calendar label.
        orderEnd: '2026-11-02T04:59:59.999Z',
        orderStart: '2025-11-01T04:00:00.000Z',
        startDate: '2025-11-01',
      }).success
    ).toBe(true);
  });

  it('requires exact order instants to be complete and ordered', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22',
        orderStart: '2026-08-01T00:00:00.000Z',
        startDate: '2026-08-01',
      }).success
    ).toBe(false);
    expect(
      adsAnalyticsQuerySchema.safeParse({
        orderEnd: '2026-08-22T18:30:00.000Z',
      }).success
    ).toBe(false);
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22',
        orderEnd: '2026-08-01T00:00:00.000Z',
        orderStart: '2026-08-22T00:00:00.000Z',
        startDate: '2026-08-01',
      }).success
    ).toBe(false);
  });

  it('rejects exact order windows longer than the reporting limit', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22',
        orderEnd: '2025-01-01T00:00:00.000Z',
        orderStart: '2024-01-01T00:00:00.000Z',
        startDate: '2026-08-01',
      }).success
    ).toBe(false);
  });

  it('rejects instants so account-local dates cannot be shifted through UTC', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-22T23:59:59.999Z',
        startDate: '2026-08-01T00:00:00.000Z',
      }).success
    ).toBe(false);
  });

  it('requires a complete ordered range', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({ startDate: '2026-08-01' }).success
    ).toBe(false);
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2026-08-01',
        startDate: '2026-08-22',
      }).success
    ).toBe(false);
  });

  it('accepts 366 inclusive days and rejects a multi-year reporting range', () => {
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2024-12-31',
        startDate: '2024-01-01',
      }).success
    ).toBe(true);
    expect(
      adsAnalyticsQuerySchema.safeParse({
        endDate: '2025-01-01',
        startDate: '2024-01-01',
      }).success
    ).toBe(false);
  });
});
