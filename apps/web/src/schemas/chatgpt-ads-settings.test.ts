import { describe, expect, it } from 'vitest';
import {
  chatgptAdsConnectionSchema,
  chatgptAdsSettingsSchema,
} from './chatgpt-ads-settings';

describe('ChatGPT Ads settings validation', () => {
  it.each([
    'a',
    'Pixel_123-xyz',
    'x'.repeat(128),
  ])('accepts valid Pixel ID %s', (pixelId) => {
    expect(chatgptAdsSettingsSchema.parse({ pixelId })).toEqual({
      pixelId,
      disconnect: false,
    });
  });
  it.each([
    '',
    'x'.repeat(129),
    'has space',
    'pixel/id',
    '<script>',
    'é',
  ])('rejects invalid Pixel ID %s', (pixelId) => {
    expect(chatgptAdsSettingsSchema.safeParse({ pixelId }).success).toBe(false);
  });
  it('trims credentials and accepts the maximum key length', () => {
    expect(
      chatgptAdsSettingsSchema.parse({
        pixelId: ' pixel ',
        capiKey: ` ${'k'.repeat(4096)} `,
      })
    ).toMatchObject({ pixelId: 'pixel', capiKey: 'k'.repeat(4096) });
    expect(
      chatgptAdsSettingsSchema.safeParse({
        pixelId: 'pixel',
        capiKey: 'k'.repeat(4097),
      }).success
    ).toBe(false);
  });
  it('allows an absent or blank key so the route can preserve the existing key', () => {
    expect(
      chatgptAdsSettingsSchema.parse({ pixelId: 'pixel' }).capiKey
    ).toBeUndefined();
    expect(
      chatgptAdsSettingsSchema.parse({ pixelId: 'pixel', capiKey: '  ' })
        .capiKey
    ).toBe('');
  });
  it('requires a Pixel ID except for explicit disconnect', () => {
    expect(chatgptAdsSettingsSchema.safeParse({ pixelId: null }).success).toBe(
      false
    );
    expect(
      chatgptAdsSettingsSchema.parse({ pixelId: null, disconnect: true })
    ).toEqual({ pixelId: null, disconnect: true });
    expect(
      chatgptAdsSettingsSchema.safeParse({ disconnect: true }).success
    ).toBe(false);
  });
  it.each([
    { pixelId: 123 },
    { pixelId: 'pixel', capiKey: null },
    { pixelId: 'pixel', disconnect: 'true' },
    { pixelId: 'pixel', merchantId: 'other' },
  ])('rejects wrong types and unknown fields', (input) => {
    expect(chatgptAdsSettingsSchema.safeParse(input).success).toBe(false);
  });
});

describe('ChatGPT Ads connection response', () => {
  it.each([
    null,
    'pixel',
  ])('accepts public connection state without a secret', (pixelId) => {
    expect(
      chatgptAdsConnectionSchema.parse({ pixelId, capiConfigured: true })
    ).toEqual({ pixelId, capiConfigured: true });
  });
  it.each([
    { pixelId: 123, capiConfigured: true },
    { pixelId: 'pixel', capiConfigured: 'true' },
    { pixelId: null },
    { pixelId: 'pixel', capiConfigured: true, capiKey: 'secret' },
  ])('rejects malformed or secret-bearing responses', (input) => {
    expect(chatgptAdsConnectionSchema.safeParse(input).success).toBe(false);
  });
});
