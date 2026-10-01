import { OGABASSEY_CDN_ORIGIN } from '@/components/storefront/ogabassey/config/storefront-origins';
import { isOgabasseyCdnImageUrl } from './ogabassey-cdn-image-url';
import {
  type OgabasseyHomeHeroResourceHintIdentity,
  ogabasseyHomeHeroResourceHintProjection,
} from './ogabassey-home-hero-resource-hint-projection';

const MERCHANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface OgabasseyHomeHeroSlideProjection {
  ctaLabel: string;
  href: string;
  id: string;
  imageAlt: string;
  imageUrl: string;
  kind: 'product';
  name: string;
  priceLabel: string;
}

export type OgabasseyHomeHeroShellInput =
  | {
      merchantId: string;
      slides: readonly OgabasseyHomeHeroSlideProjection[];
      status: 'published';
    }
  | {
      merchantId?: string;
      status: 'unpublished';
    };

export interface OgabasseyHomeHeroProjection {
  candidate: OgabasseyHomeHeroSlideProjection;
  merchantId: string;
  slideCount: number;
  version: 1;
}

export type OgabasseyHomeHeroRequestPublication =
  | { merchantId: string; status: 'published' }
  | { status: 'unbound' | 'unpublished' };

export interface OgabasseyHomeHeroRendererInput {
  preload: OgabasseyHomeHeroResourceHintIdentity | null;
  projection: OgabasseyHomeHeroProjection;
  renderedSlides: readonly OgabasseyHomeHeroSlideProjection[];
  requestPublication: OgabasseyHomeHeroRequestPublication;
}

type OgabasseyHomeHeroRendererAssessment =
  | { valid: true }
  | {
      reason:
        | 'merchant_mismatch'
        | 'publication_mismatch'
        | 'preload_mismatch'
        | 'rendered_candidate_mismatch'
        | 'slide_cardinality_mismatch';
      valid: false;
    };

function isCanonicalCandidateImage(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      value.startsWith('https://') &&
      url.origin === OGABASSEY_CDN_ORIGIN &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      (url.pathname.startsWith('/core-assets/products/') ||
        url.pathname.startsWith('/products/')) &&
      /\.(avif|jpe?g|png|webp)$/i.test(url.pathname) &&
      isOgabasseyCdnImageUrl(value)
    );
  } catch {
    return false;
  }
}

function getCandidate(
  slides: unknown
): OgabasseyHomeHeroSlideProjection | null {
  if (!Array.isArray(slides)) {
    return null;
  }
  const typedSlides: OgabasseyHomeHeroSlideProjection[] = [];
  for (const [index, slide] of slides.entries()) {
    if (!isValidSlide(slide, index === 0)) {
      return null;
    }
    typedSlides.push(slide as OgabasseyHomeHeroSlideProjection);
  }
  const slide = typedSlides[0];
  if (!slide) {
    return null;
  }

  return {
    ctaLabel: slide.ctaLabel,
    href: slide.href,
    id: slide.id,
    imageAlt: slide.imageAlt,
    imageUrl: slide.imageUrl,
    kind: slide.kind,
    name: slide.name,
    priceLabel: slide.priceLabel,
  };
}

function isValidSlide(
  value: unknown,
  requireCanonicalImage = false
): value is OgabasseyHomeHeroSlideProjection {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const slide = value as Record<string, unknown>;
  const requiredStringFields = [
    'ctaLabel',
    'href',
    'id',
    'imageAlt',
    'imageUrl',
    'name',
    'priceLabel',
  ];
  if (
    slide.kind !== 'product' ||
    !requiredStringFields.every(
      (field) =>
        typeof slide[field] === 'string' &&
        (slide[field] as string).trim().length > 0
    )
  ) {
    return false;
  }
  const imageUrl = slide.imageUrl as string;
  return (
    imageUrl === imageUrl.trim() &&
    (!requireCanonicalImage || isCanonicalCandidateImage(imageUrl))
  );
}

function isMerchantId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === 36 &&
    MERCHANT_ID_PATTERN.test(value)
  );
}

function isValidProjection(
  value: unknown
): value is OgabasseyHomeHeroProjection {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const projection = value as OgabasseyHomeHeroProjection;
  return (
    projection.version === 1 &&
    isMerchantId(projection.merchantId) &&
    Number.isInteger(projection.slideCount) &&
    projection.slideCount > 0 &&
    isValidSlide(projection.candidate, true)
  );
}

function sameCandidate(
  left: OgabasseyHomeHeroSlideProjection,
  right: OgabasseyHomeHeroSlideProjection | undefined
): boolean {
  if (!right) {
    return false;
  }
  return (
    left.ctaLabel === right.ctaLabel &&
    left.href === right.href &&
    left.id === right.id &&
    left.imageAlt === right.imageAlt &&
    left.imageUrl === right.imageUrl &&
    left.kind === right.kind &&
    left.name === right.name &&
    left.priceLabel === right.priceLabel
  );
}

/**
 * Pure H1A preparation contract for the current homepage seam. It deliberately
 * has no route, cache, or rendering side effects; later H1 phases can adopt
 * this single candidate/preload/renderer identity without changing it.
 */
export const ogabasseyHomeHeroContract = {
  assessRenderer(
    input: OgabasseyHomeHeroRendererInput
  ): OgabasseyHomeHeroRendererAssessment {
    if (!input || typeof input !== 'object') {
      return { reason: 'publication_mismatch', valid: false };
    }
    if (!Array.isArray(input.renderedSlides)) {
      return { reason: 'rendered_candidate_mismatch', valid: false };
    }
    if (
      !input.requestPublication ||
      typeof input.requestPublication !== 'object' ||
      (input.requestPublication.status !== 'published' &&
        input.requestPublication.status !== 'unpublished' &&
        input.requestPublication.status !== 'unbound')
    ) {
      return { reason: 'publication_mismatch', valid: false };
    }
    if (!isValidProjection(input.projection)) {
      return { reason: 'rendered_candidate_mismatch', valid: false };
    }
    if (input.requestPublication.status !== 'published') {
      return { reason: 'publication_mismatch', valid: false };
    }
    if (
      !isMerchantId(input.projection.merchantId) ||
      !isMerchantId(input.requestPublication.merchantId) ||
      input.projection.merchantId !== input.requestPublication.merchantId
    ) {
      return { reason: 'merchant_mismatch', valid: false };
    }
    const expectedPreload = ogabasseyHomeHeroResourceHintProjection.build(
      input.projection.candidate.imageUrl
    );
    if (
      !expectedPreload ||
      !input.preload ||
      expectedPreload.digest !== input.preload.digest ||
      !ogabasseyHomeHeroResourceHintProjection.validate(input.preload)
    ) {
      return { reason: 'preload_mismatch', valid: false };
    }
    if (input.projection.slideCount !== input.renderedSlides.length) {
      return { reason: 'slide_cardinality_mismatch', valid: false };
    }
    if (!sameCandidate(input.projection.candidate, input.renderedSlides[0])) {
      return { reason: 'rendered_candidate_mismatch', valid: false };
    }
    return { valid: true };
  },

  preloadIdentity(
    projection: unknown
  ): OgabasseyHomeHeroResourceHintIdentity | null {
    if (!isValidProjection(projection)) {
      return null;
    }
    return ogabasseyHomeHeroResourceHintProjection.build(
      projection.candidate.imageUrl
    );
  },

  project(
    shell: OgabasseyHomeHeroShellInput
  ): OgabasseyHomeHeroProjection | null {
    if (
      !shell ||
      typeof shell !== 'object' ||
      shell.status !== 'published' ||
      !isMerchantId(shell.merchantId)
    ) {
      return null;
    }
    const candidate = getCandidate(shell.slides);
    if (!candidate) {
      return null;
    }
    return {
      candidate,
      merchantId: shell.merchantId,
      slideCount: shell.slides.length,
      version: 1,
    };
  },
} as const;
