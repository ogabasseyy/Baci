import { describe, expect, it } from 'vitest';
import { buildUpstreamOgabasseyTransformUrl } from './build-upstream-ogabassey-transform-url';

describe('buildUpstreamOgabasseyTransformUrl', () => {
  it('builds a canonical CDN transform URL with optional quality override and version query', () => {
    expect(
      buildUpstreamOgabasseyTransformUrl(
        {
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width: 384,
        },
        'core-assets/products/tecno.avif'
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/tecno.avif'
    );

    expect(
      buildUpstreamOgabasseyTransformUrl(
        {
          fit: 'cover',
          format: 'jpeg',
          height: 540,
          quality: 70,
          width: 750,
        },
        'core-assets/products/tecno.avif',
        60,
        new URLSearchParams('v=20260927&ignored=1')
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=750,height=540,quality=60,format=jpeg,fit=cover/core-assets/products/tecno.avif?v=20260927'
    );
  });

  it('re-encodes decoded reserved characters in asset path segments while preserving slashes', () => {
    expect(
      buildUpstreamOgabasseyTransformUrl(
        {
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width: 384,
        },
        'core-assets/products/phone#red 5g?.avif'
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/phone%23red%205g%3F.avif'
    );
  });
});
