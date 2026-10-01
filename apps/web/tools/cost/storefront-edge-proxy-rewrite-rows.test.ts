import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_PROXY_REWRITE_ROWS } from './storefront-edge-proxy-rewrite-rows';

describe('STOREFRONT_EDGE_PROXY_REWRITE_ROWS', () => {
  it('keeps retired Markdown OPTIONS on the origin rewrite path', () => {
    // Arrange
    const byId = new Map(
      STOREFRONT_EDGE_PROXY_REWRITE_ROWS.map((row) => [row.id, row])
    );

    // Act and assert
    expect(byId.get('proxy:root-domain-retired-slug-markdown')).toEqual(
      expect.objectContaining({ methods: ['GET', 'HEAD'] })
    );
    expect(byId.get('proxy:markdown-mirror')).toEqual(
      expect.objectContaining({
        decision: 'origin_dynamic',
        methods: ['GET', 'HEAD', 'OPTIONS'],
      })
    );
  });
});
