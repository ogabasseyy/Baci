import { describe, expect, it } from 'vitest';
import {
  CHAT_SANTA_MAX_OFFERS,
  CHAT_SANTA_OFFERS_KEY,
  chatSantaOfferSchema,
} from './chat-santa-offer';

describe('chatSantaOfferSchema', () => {
  const validOffer = {
    productId: 'prod-1',
    slug: 'iphone-15-pro',
    name: 'iPhone 15 Pro',
    catalogPrice: 1_500_000,
    grantedPrice: 1_400_000,
    currency: 'NGN',
  };

  it('accepts a verified offer with required fields', () => {
    expect(chatSantaOfferSchema.parse(validOffer)).toEqual(validOffer);
    expect(CHAT_SANTA_OFFERS_KEY).toBe('baci_santa_offers');
    expect(CHAT_SANTA_MAX_OFFERS).toBe(3);
  });

  it('rejects empty slug, empty productId, non-positive catalogPrice, or negative grantedPrice', () => {
    expect(
      chatSantaOfferSchema.safeParse({ ...validOffer, slug: '' }).success
    ).toBe(false);
    expect(
      chatSantaOfferSchema.safeParse({ ...validOffer, productId: '' }).success
    ).toBe(false);
    expect(
      chatSantaOfferSchema.safeParse({ ...validOffer, catalogPrice: 0 }).success
    ).toBe(false);
    expect(
      chatSantaOfferSchema.safeParse({ ...validOffer, grantedPrice: -1 })
        .success
    ).toBe(false);
  });
});
