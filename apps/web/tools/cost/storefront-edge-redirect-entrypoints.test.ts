import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS } from './storefront-edge-redirect-entrypoints';

describe('STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS', () => {
  it('contains only redirect-only handlers', () => {
    expect(STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS).toContain(
      'news-sitemap.xml/route.ts'
    );
    expect(STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS).not.toContain(
      'storefront/[legacySlug]/swap/route.ts'
    );
  });
});
