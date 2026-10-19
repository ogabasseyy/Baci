import {
  MOBILE_HERO_IMAGE_SIZES,
  MOBILE_HERO_SOURCE_MEDIA,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import type { LaunchProductSlide } from '@/components/storefront/ogabassey/components/LaunchCarousel';
import type { OgabasseyMobileSlot } from './ogabassey-mobile-adapter';

// Hero-slide fixtures, split from lab-fixtures.ts under the repo
// one-primary-export rule: slide construction plus the hero slot.
// Directive-free like its sibling (SSR + client-clone reuse).

// Lab hero slides: slide-0 mounts the selected binding. Slide-1 is
// out-of-binding filler sharing slide-0's staged ORIGINAL bytes in BOTH arms
// (never optimized): it exists so the lab exercises the production-common
// multi-slide shell (dots + play toggle). SSR renders no slide-1 image at
// load (only the current/prioritized slide renders), so the filler costs
// nothing until interaction. Commerce fields are fixed lab constants
// (identical arms); only slide-0's image varies.
export function labHeroSlides(input: {
  // Inline union (not the PilotLabArm import): this module must stay
  // directive-free for client-clone reuse, and lab-mount is server-only.
  arm: 'control' | 'pilot';
  basePath: string;
  slide0: { imageAlt: string; imageUrl: string; name: string };
  slide1?: { imageAlt: string; imageUrl: string; name: string };
}): LaunchProductSlide[] {
  // The fixture destination has no arm of its own: without the pin, its
  // Back link returns to the store's default pilot arm and silently flips
  // a control session mid-browse.
  const suffix = `?arm=${input.arm}`;
  const slides: LaunchProductSlide[] = [
    {
      kind: 'product',
      id: 'lab-hero-slide-0',
      name: input.slide0.name,
      priceLabel: '₦50,000',
      href: `${input.basePath}/lab-category/lab-hero-slide-0${suffix}`,
      imageUrl: input.slide0.imageUrl,
      imageAlt: input.slide0.imageAlt,
      ctaLabel: 'Shop now',
    },
  ];
  if (input.slide1) {
    slides.push({
      kind: 'product',
      id: 'lab-hero-slide-1',
      name: input.slide1.name,
      priceLabel: '₦45,000',
      href: `${input.basePath}/lab-category/lab-hero-slide-1${suffix}`,
      imageUrl: input.slide1.imageUrl,
      imageAlt: input.slide1.imageAlt,
      ctaLabel: 'Shop now',
    });
  }
  return slides;
}

export function labHeroSlot(alt: string): OgabasseyMobileSlot {
  return {
    alt,
    imageFit: 'contain',
    media: MOBILE_HERO_SOURCE_MEDIA,
    sizes: MOBILE_HERO_IMAGE_SIZES,
  };
}
