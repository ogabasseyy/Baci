import { expect, it } from 'vitest';
import {
  imeiAnalyticsQuerySchema,
  imeiAnalyticsSchema,
} from './imei-check-analytics';

it('defaults to 30 days and validates period and merchant filters', () => {
  expect(imeiAnalyticsQuerySchema.parse({})).toEqual({ period: '30d' });
  expect(
    imeiAnalyticsQuerySchema.parse({ period: 'all', merchantSlug: 'store-one' })
  ).toEqual({ period: 'all', merchantSlug: 'store-one' });
  for (const input of [
    { period: '1d' },
    { merchantSlug: '../other' },
    { merchantSlug: 'a'.repeat(101) },
  ]) {
    expect(imeiAnalyticsQuerySchema.safeParse(input).success).toBe(false);
  }
});
it('accepts empty aggregate results and rejects invalid counts', () => {
  const data = {
    generatedAt: '2026-10-25T12:00:00Z',
    summary: {
      requests: 0,
      completed: 0,
      uniqueDevices: 0,
      unidentified: 0,
      matchedImages: 0,
    },
    topModels: [],
    topVariants: [],
    topBrands: [],
    services: [],
  };
  expect(imeiAnalyticsSchema.parse(data)).toEqual(data);
  for (const requests of [-1, 1.5]) {
    expect(
      imeiAnalyticsSchema.safeParse({
        ...data,
        summary: { ...data.summary, requests },
      }).success
    ).toBe(false);
  }
});
