import { afterEach, expect, it, vi } from 'vitest';
import { findGiftCardPreviewMatches } from './preview-catalog';

afterEach(() => vi.unstubAllEnvs());

it('finds the US PlayStation pilot card for PSN searches', () => {
  vi.stubEnv('OGABASSEY_GIFT_CARD_PREVIEW_USD_CENTS', '{"2844":1028}');
  expect(findGiftCardPreviewMatches('PSN US $10')).toEqual([
    { id: '2844', brand: 'PlayStation Store', denomination: 10 },
  ]);
});

it('matches configured gift cards by brand and never returns supplier costs', () => {
  vi.stubEnv(
    'OGABASSEY_GIFT_CARD_PREVIEW_USD_CENTS',
    '{"3007":630,"2067":615}'
  );
  expect(findGiftCardPreviewMatches('Amazon gift card')).toEqual([
    { id: '3007', brand: 'Amazon', denomination: 5 },
  ]);
  expect(findGiftCardPreviewMatches('gift cards')).toHaveLength(2);
  expect(findGiftCardPreviewMatches('iPhone')).toEqual([]);
});
