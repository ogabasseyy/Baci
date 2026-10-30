import {
  MOBILE_HERO_MIN_SRCSET_WIDTH,
  MOBILE_HERO_QUALITY_STEPS,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { OgabasseyCdnImageProxyRequest } from '@/schemas/ogabassey-cdn-image-proxy';

/**
 * Returns the descending AVIF quality step-down ladder starting from the
 * requested quality (`options.quality`, followed by lower configured steps in
 * `MOBILE_HERO_QUALITY_STEPS`) for mobile hero (`<= 384w`) AVIF requests, or a
 * single-element `[quality]` array for wider or non-AVIF requests.
 */
export function getCandidateQualitiesForRequest(
  options: OgabasseyCdnImageProxyRequest['options']
): readonly number[] {
  if (
    options.format === 'avif' &&
    options.width <= MOBILE_HERO_MIN_SRCSET_WIDTH
  ) {
    const lowerSteps = MOBILE_HERO_QUALITY_STEPS.filter(
      (step) => step < options.quality
    );
    return [options.quality, ...lowerSteps];
  }
  return [options.quality];
}
