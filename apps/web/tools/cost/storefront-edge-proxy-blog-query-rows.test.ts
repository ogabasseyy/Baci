import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS } from './storefront-edge-proxy-blog-query-rows';

describe('STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS', () => {
  it('covers root and slug-prefixed blog query canonicalization', () => {
    expect(STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS.map(({ id }) => id)).toEqual([
      'proxy:blog-query-canonical',
      'proxy:slug-blog-query-canonical',
    ]);
    expect(
      STOREFRONT_EDGE_PROXY_BLOG_QUERY_ROWS.every(
        ({ decision, methods, pathCondition }) =>
          decision === 'edge_redirect' &&
          methods.join(',') === 'GET,HEAD' &&
          pathCondition?.predicate === 'legacy_blog_thumbnail_query'
      )
    ).toBe(true);
  });
});
