import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS } from './storefront-edge-entrypoint-classifications';

describe('STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS', () => {
  it('keeps redirect and dynamic wildcard outcomes explicit', () => {
    expect(
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(
        'storefront/[legacySlug]/swap/route.ts'
      )
    ).toEqual(expect.objectContaining({ decision: 'origin_dynamic' }));
    expect(
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(
        '(content)/pages/about/page.tsx'
      )
    ).toEqual(expect.objectContaining({ decision: 'edge_redirect' }));
  });

  it('keeps the rolling news sitemap on the origin', () => {
    expect(
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(
        '(blog)/blog/news-sitemap.xml/route.ts'
      )
    ).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        reason: 'rolling_news_sitemap_requires_origin',
      })
    );
  });

  it('keeps inventory-qualified graphics hubs on the origin', () => {
    expect(
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(
        '(catalog)/(listing)/[category]/graphics/[graphicsSlug]/page.tsx'
      )
    ).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        reason: 'request_state_or_origin_action_required',
      })
    );
  });
});
