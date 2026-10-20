import { describe, expect, it } from 'vitest';
import { makeOfferLineKey } from './offer-line-key';

describe('makeOfferLineKey', () => {
  it('keys resolutions by product and offer', () => {
    expect(makeOfferLineKey('p', 'o')).toBe('p::o');
  });
});
