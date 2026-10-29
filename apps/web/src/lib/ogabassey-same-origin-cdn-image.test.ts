import { describe, expect, it } from 'vitest';
import {
  buildUpstreamOgabasseyTransformUrl,
  getCandidateQualitiesForRequest,
} from './ogabassey-same-origin-cdn-image';

describe('ogabassey-same-origin-cdn-image', () => {
  it('builds upstream CDN URLs with optional quality overrides, allowlisted v query param, and encoded asset segments', () => {
    const options = {
      fit: 'inside' as const,
      format: 'avif' as const,
      quality: 70,
      width: 384,
    };

    expect(
      buildUpstreamOgabasseyTransformUrl(
        options,
        'core-assets/products/redmi.jpg'
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/redmi.jpg'
    );
    expect(
      buildUpstreamOgabasseyTransformUrl(
        options,
        'core-assets/products/redmi.jpg',
        60,
        new URLSearchParams('v=20260927&bust=123')
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=384,quality=60,format=avif/core-assets/products/redmi.jpg?v=20260927'
    );
    expect(
      buildUpstreamOgabasseyTransformUrl(
        options,
        'core-assets/products/phone#red 5g.avif'
      )
    ).toBe(
      'https://cdn.ogabassey.com/image/width=384,quality=70,format=avif/core-assets/products/phone%23red%205g.avif'
    );
  });

  it('returns the quality step-down ladder for mobile AVIF transforms and single quality otherwise', () => {
    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'avif',
        quality: 70,
        width: 384,
      })
    ).toEqual([70, 60, 50]);

    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'avif',
        quality: 70,
        width: 640,
      })
    ).toEqual([70]);

    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'jpeg',
        quality: 70,
        width: 384,
      })
    ).toEqual([70]);
  });
});
