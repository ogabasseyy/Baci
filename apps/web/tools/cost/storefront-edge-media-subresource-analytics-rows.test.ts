import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS } from './storefront-edge-media-subresource-analytics-rows';

describe('storefront edge media subresource analytics rows', () => {
  it('exports analytics pixel and widget rows', () => {
    expect(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS.length
    ).toBeGreaterThan(0);
    expect(
      STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS.every(
        (r) => r.sourceKind === 'automatic_subresource'
      )
    ).toBe(true);
  });

  it('binds google analytics collection with POST method', () => {
    const ga = STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS.find(
      (r) => r.id === 'automatic-subresource:google-analytics-collection'
    );
    expect(ga).toBeDefined();
    expect(ga?.methods).toContain('POST');
  });

  it('binds negotiation evidence upload with PUT method', () => {
    const upload = STOREFRONT_EDGE_MEDIA_SUBRESOURCE_ANALYTICS_ROWS.find(
      (r) => r.id === 'automatic-subresource:negotiation-evidence-upload'
    );
    expect(upload).toBeDefined();
    expect(upload?.methods).toEqual(['PUT', 'OPTIONS']);
  });
});
