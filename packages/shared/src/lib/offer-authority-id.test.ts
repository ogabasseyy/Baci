import { describe, expect, it } from 'vitest';
import { isOfferAuthorityId } from './offer-authority-id';

describe('isOfferAuthorityId', () => {
  it('accepts UUID spellings in either hex case', () => {
    expect(isOfferAuthorityId('11111111-1111-4111-8111-111111111111')).toBe(
      true
    );
    expect(
      isOfferAuthorityId('11111111-1111-4111-8111-111111111111'.toUpperCase())
    ).toBe(true);
  });

  it('rejects non-UUID values', () => {
    expect(isOfferAuthorityId('not-a-uuid')).toBe(false);
    expect(isOfferAuthorityId('')).toBe(false);
    expect(isOfferAuthorityId(null)).toBe(false);
    expect(isOfferAuthorityId(42)).toBe(false);
  });
});
