import { z } from 'zod';
import {
  type BuilderDesignCapabilityManifest,
  builderDesignCapabilities,
} from '../builder-design-capabilities';
import { safeStorefrontUrlSchema } from './safe-storefront-url';

function compileField(descriptor: {
  maximumLength?: number;
  required?: boolean;
  type: string;
}) {
  if (descriptor.type === 'safe-link')
    return safeStorefrontUrlSchema.optional();
  if (descriptor.type === 'string') {
    const bounded = z
      .string()
      .trim()
      .max(descriptor.maximumLength ?? Number.MAX_SAFE_INTEGER);
    return (descriptor.required ? bounded.min(1) : bounded).optional();
  }
  throw new Error(
    `Unsupported HeroCarousel descriptor type: ${descriptor.type}`
  );
}

export function getHeroCarouselSlidePatchFields(
  manifest: BuilderDesignCapabilityManifest = builderDesignCapabilities
): Record<string, z.ZodType> {
  const props = manifest.components.find(
    ({ componentType }) => componentType === 'HeroCarousel'
  )?.specialOperations?.updateCarouselSlide;
  if (!props)
    throw new Error('Missing HeroCarousel updateCarouselSlide contract');
  return Object.fromEntries(
    Object.entries(props).map(([property, descriptor]) => [
      property,
      compileField(descriptor),
    ])
  );
}

export const heroCarouselSlidePatchFields = getHeroCarouselSlidePatchFields();
