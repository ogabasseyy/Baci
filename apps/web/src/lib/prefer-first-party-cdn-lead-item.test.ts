import { describe, expect, it } from 'vitest';
import { preferFirstPartyCdnLeadItem } from './prefer-first-party-cdn-lead-item';

describe('preferFirstPartyCdnLeadItem', () => {
  it('promotes the first CDN-backed item to index 0 when the lead item uses an external origin', () => {
    const items = [
      { id: 'ext-1', image: 'https://images.samsung.com/flip8.jpg' },
      {
        id: 'cdn-1',
        image: 'https://cdn.ogabassey.com/core-assets/products/s26-fe.avif',
      },
      { id: 'ext-2', image: 'https://images.apple.com/iphone.jpg' },
    ];

    expect(
      preferFirstPartyCdnLeadItem(items, (item) => item.image).map((i) => i.id)
    ).toEqual(['cdn-1', 'ext-1', 'ext-2']);
  });

  it('prefers a same-origin /cdn-image/ proxy-eligible CDN item over an uppercase-extension origin-only CDN item', () => {
    const items = [
      {
        id: 'cdn-uppercase',
        image: 'https://cdn.ogabassey.com/core-assets/products/phone.JPG',
      },
      {
        id: 'cdn-proxy-eligible',
        image: 'https://cdn.ogabassey.com/core-assets/products/fold.avif',
      },
    ];

    expect(
      preferFirstPartyCdnLeadItem(items, (item) => item.image).map((i) => i.id)
    ).toEqual(['cdn-proxy-eligible', 'cdn-uppercase']);
  });

  it('recognizes same-origin /cdn-image/ URLs and leaves already-CDN-led or single-item lists unchanged', () => {
    const sameOriginLed = [
      {
        id: 'same-origin',
        image:
          '/cdn-image/width=384,quality=70,format=avif/core-assets/products/a.avif',
      },
      {
        id: 'cdn-2',
        image: 'https://cdn.ogabassey.com/core-assets/products/b.avif',
      },
    ];

    expect(
      preferFirstPartyCdnLeadItem(sameOriginLed, (item) => item.image)
    ).toEqual(sameOriginLed);

    const invalidSameOriginFirst = [
      {
        id: 'invalid-same-origin',
        image: '/cdn-image/not-a-valid-path',
      },
      {
        id: 'valid-tier-1',
        image: 'https://cdn.ogabassey.com/core-assets/products/phone.JPG',
      },
    ];
    expect(
      preferFirstPartyCdnLeadItem(
        invalidSameOriginFirst,
        (item) => item.image
      ).map((i) => i.id)
    ).toEqual(['valid-tier-1', 'invalid-same-origin']);

    const externalOnly = [
      { id: 'ext-1', image: 'https://example.com/a.jpg' },
      { id: 'ext-2', image: 'https://example.com/b.jpg' },
    ];
    expect(
      preferFirstPartyCdnLeadItem(externalOnly, (item) => item.image)
    ).toEqual(externalOnly);
  });
});
