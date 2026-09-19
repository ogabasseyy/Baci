import { describe, expect, it } from 'vitest';
import { isOfferClaimedUrl } from '@/lib/is-offer-claimed-url';

describe('isOfferClaimedUrl', () => {
  it('matches exact urls', () => {
    const claimed = new Set(['https://cdn.example/offer.jpg']);
    expect(isOfferClaimedUrl('https://cdn.example/offer.jpg', claimed)).toBe(
      true
    );
    expect(isOfferClaimedUrl('https://cdn.example/other.jpg', claimed)).toBe(
      false
    );
    expect(isOfferClaimedUrl('https://cdn.example/offer.jpg', new Set())).toBe(
      false
    );
    expect(isOfferClaimedUrl(null, claimed)).toBe(false);
  });

  it('matches a relative claim against the same absolute path', () => {
    const claimed = new Set(['/images/used.jpg']);
    expect(
      isOfferClaimedUrl('https://cdn.example/images/used.jpg', claimed)
    ).toBe(true);
    expect(
      isOfferClaimedUrl('https://cdn.example/images/other.jpg', claimed)
    ).toBe(false);
  });

  it('ignores query strings and fragments when comparing paths', () => {
    const claimed = new Set(['/images/used.jpg?v=2']);
    expect(
      isOfferClaimedUrl('https://cdn.example/images/used.jpg', claimed)
    ).toBe(true);
    expect(
      isOfferClaimedUrl(
        'https://cdn.example/images/used.jpg?width=100',
        new Set(['/images/used.jpg'])
      )
    ).toBe(true);
    expect(
      isOfferClaimedUrl('https://cdn.example/images/other.jpg?v=2', claimed)
    ).toBe(false);
  });

  it('does not match an absolute claim from another host by path alone', () => {
    const claimed = new Set(['https://other.example/images/used.jpg']);
    expect(
      isOfferClaimedUrl('https://cdn.example/images/used.jpg', claimed)
    ).toBe(false);
  });
});
