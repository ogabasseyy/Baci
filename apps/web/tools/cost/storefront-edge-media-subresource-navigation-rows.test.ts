import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_NAVIGATION_ROWS } from './storefront-edge-media-subresource-navigation-rows';

describe('storefront edge media subresource navigation rows', () => {
  it('exports footer, blog, chat, and insurance navigation rows', () => {
    expect(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_NAVIGATION_ROWS.length
    ).toBeGreaterThan(0);
  });

  it('binds receipt claim app store rows', () => {
    const ids = STOREFRONT_EDGE_MEDIA_SUBRESOURCE_NAVIGATION_ROWS.map(
      (r) => r.id
    );
    expect(ids).toContain(
      'automatic-subresource:receipt-claim-app-store-navigation'
    );
    expect(ids).toContain(
      'automatic-subresource:receipt-claim-play-store-navigation'
    );
  });

  it('binds footer social and app store rows', () => {
    const ids = STOREFRONT_EDGE_MEDIA_SUBRESOURCE_NAVIGATION_ROWS.map(
      (r) => r.id
    );
    expect(ids).toContain(
      'automatic-subresource:footer-merchant-social-navigation'
    );
    expect(ids).toContain('automatic-subresource:footer-app-store-navigation');
    expect(ids).toContain('automatic-subresource:footer-play-store-navigation');
  });
});
