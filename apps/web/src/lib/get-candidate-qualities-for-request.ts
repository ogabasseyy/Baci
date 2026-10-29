import {
  MOBILE_HERO_MIN_SRCSET_WIDTH,
  MOBILE_HERO_QUALITY_STEPS,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { OgabasseyCdnImageProxyRequest } from '@/schemas/ogabassey-cdn-image-proxy';

export function getCandidateQualitiesForRequest(
  options: OgabasseyCdnImageProxyRequest['options']
): readonly number[] {
  if (
    options.format === 'avif' &&
    options.width <= MOBILE_HERO_MIN_SRCSET_WIDTH
  ) {
    const stepsBelowOrEqual = MOBILE_HERO_QUALITY_STEPS.filter(
      (step) => step <= options.quality
    );
    return stepsBelowOrEqual.length > 0 ? stepsBelowOrEqual : [options.quality];
  }
  return [options.quality];
}
