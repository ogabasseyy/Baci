import { expect, it } from 'vitest';
import { xAdsSettingsSchema } from './x-ads-settings';

it('validates merchant Pixel event ownership', () => {
  expect(
    xAdsSettingsSchema.safeParse({
      pixelId: 'abc',
      eventIds: { purchase: 'tw-abc-paid' },
    }).success
  ).toBe(true);
  expect(
    xAdsSettingsSchema.safeParse({
      pixelId: 'abc',
      eventIds: { purchase: 'tw-other-paid' },
    }).success
  ).toBe(false);
});
it('rejects unknown keys and partial credentials', () => {
  expect(
    xAdsSettingsSchema.safeParse({
      pixelId: 'abc',
      eventIds: { secret: 'must-not-project' },
    }).success
  ).toBe(false);
  expect(
    xAdsSettingsSchema.safeParse({
      pixelId: 'abc',
      credentials: { consumerKey: 'key' },
    }).success
  ).toBe(false);
});
it('allows browser-only setup and explicit disconnection', () => {
  expect(xAdsSettingsSchema.parse({ pixelId: 'abc' })).toEqual({
    pixelId: 'abc',
    eventIds: {},
    disconnect: false,
  });
  expect(
    xAdsSettingsSchema.safeParse({ pixelId: null, disconnect: true }).success
  ).toBe(true);
});
