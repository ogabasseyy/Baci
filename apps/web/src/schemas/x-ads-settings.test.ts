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

const base = { pixelId: 'abc', eventIds: { purchase: 'tw-abc-paid' } };
it('accepts write-only pixel token mode', () => {
  expect(
    xAdsSettingsSchema.safeParse({
      ...base,
      credentials: { pixelToken: 'synthetic-token' },
    }).success
  ).toBe(true);
});
it.each([
  '',
  'bad\r\nHeader:value',
  'space token',
  'x'.repeat(4097),
])('rejects malformed pixel token %s', (pixelToken) => {
  expect(
    xAdsSettingsSchema.safeParse({ ...base, credentials: { pixelToken } })
      .success
  ).toBe(false);
});
it('rejects mixed and partial modes while retaining complete OAuth', () => {
  const oauth = {
    consumerKey: 'key',
    consumerSecret: 'secret',
    accessToken: 'token',
    accessTokenSecret: 'secret',
  };
  expect(
    xAdsSettingsSchema.safeParse({ ...base, credentials: oauth }).success
  ).toBe(true);
  expect(
    xAdsSettingsSchema.safeParse({
      ...base,
      credentials: { ...oauth, pixelToken: 'token' },
    }).success
  ).toBe(false);
  expect(
    xAdsSettingsSchema.safeParse({
      ...base,
      credentials: { consumerKey: 'key' },
    }).success
  ).toBe(false);
});
