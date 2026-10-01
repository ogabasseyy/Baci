import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS } from './storefront-edge-media-subresource-content-rows';

describe('storefront edge media subresource content rows', () => {
  it('exports CDN, storage, and template media rows', () => {
    expect(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS.length
    ).toBeGreaterThan(0);
  });

  it('starts with the default CDN and storage rows', () => {
    expect(STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS[0]?.id).toBe(
      'automatic-subresource:media-cdn'
    );
    expect(STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS[1]?.id).toBe(
      'automatic-subresource:supabase-storage'
    );
  });

  it('includes blog content renderer and safe-html rows', () => {
    const ids = STOREFRONT_EDGE_MEDIA_SUBRESOURCE_CONTENT_ROWS.map((r) => r.id);
    expect(ids).toContain(
      'automatic-subresource:blog-content-renderer-external'
    );
    expect(ids).toContain('automatic-subresource:blog-safe-html-external');
  });
});
