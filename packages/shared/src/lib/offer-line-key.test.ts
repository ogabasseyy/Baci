import { describe, expect, it } from 'vitest';
import { makeOfferLineKey } from './offer-line-key';

describe('makeOfferLineKey', () => {
  it('keys resolutions by product and offer', () => {
    expect(makeOfferLineKey('p', 'o')).toBe('p::o');
  });

  it('matches uppercase UUID spellings to their lowercase keys', () => {
    const lower = makeOfferLineKey(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222'
    );
    expect(
      makeOfferLineKey(
        '11111111-1111-4111-8111-111111111111'.toUpperCase(),
        '22222222-2222-4222-8222-222222222222'.toUpperCase()
      )
    ).toBe(lower);
  });
});
