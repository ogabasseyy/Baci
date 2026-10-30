import { describe, expect, it } from 'vitest';
import {
  DESKTOP_HERO_BIG_MAX_SRCSET_WIDTH,
  DESKTOP_HERO_BIG_MIN_SRCSET_WIDTH,
  MOBILE_HERO_MAX_SRCSET_WIDTH,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { getCandidateQualitiesForRequest } from './get-candidate-qualities-for-request';

describe('getCandidateQualitiesForRequest', () => {
  it('returns descending quality steps for 384w mobile AVIF requests and single quality otherwise', () => {
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
        width: 1080,
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

  it('applies the byte-cap ladder to the 750w mobile hero rung that DPR-3 phones select', () => {
    expect(
      getCandidateQualitiesForRequest({
        fit: 'inside',
        format: 'avif',
        quality: 70,
        width: MOBILE_HERO_MAX_SRCSET_WIDTH,
      })
    ).toEqual([70, 60, 50]);
  });

  it('leaves both desktop big-hero AVIF rungs on the single uncapped quality', () => {
    for (const width of [
      DESKTOP_HERO_BIG_MIN_SRCSET_WIDTH,
      DESKTOP_HERO_BIG_MAX_SRCSET_WIDTH,
    ]) {
      expect(width).not.toBe(MOBILE_HERO_MAX_SRCSET_WIDTH);
      expect(
        getCandidateQualitiesForRequest({
          fit: 'inside',
          format: 'avif',
          quality: 70,
          width,
        })
      ).toEqual([70]);
    }
  });
});
