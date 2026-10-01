import { describe, expect, it } from 'vitest';
import { selectOgabasseyLaunchProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-launch-products';
import { buildLaunchSlides } from '@/components/storefront/ogabassey/components/build-launch-slides';
import type { StorefrontHomeProduct } from '@/lib/cached-data';
import { ogabasseyHomeHeroContract } from './ogabassey-home-hero-contract';

function createRow(): StorefrontHomeProduct {
  return {
    id: 'product-1',
    name: 'Samsung Galaxy A27 5G',
    slug: 'samsung-galaxy-a27-5g',
    price: 50000,
    images: ['https://cdn.ogabassey.com/products/a27.avif'],
    category: 'Smartphones',
    brand: 'Samsung',
    condition: 'new',
    stock: 2,
    stock_quantity: null,
    manage_stock: false,
    low_stock_threshold: null,
    product_categories: [],
  };
}

function createPublishedShell() {
  const selectedProducts = selectOgabasseyLaunchProducts({
    launchCandidateRows: [createRow()],
    pinnedProductRows: [],
  });
  return {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74' as const,
    status: 'published' as const,
    slides: buildLaunchSlides(selectedProducts, 'https://ogabassey.com'),
  };
}

function createFixture() {
  const projection = ogabasseyHomeHeroContract.project(createPublishedShell());
  if (!projection) throw new Error('expected a published projection');
  const preload = ogabasseyHomeHeroContract.preloadIdentity(projection);
  if (!preload) throw new Error('expected a CDN preload projection');
  return { projection, preload };
}

describe('ogabasseyHomeHeroContract renderer assessment', () => {
  it('accepts matching publication, preload, and rendered slide identity', () => {
    const { projection, preload } = createFixture();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload,
        projection,
        renderedSlides: [projection.candidate],
        requestPublication: {
          merchantId: projection.merchantId,
          status: 'published',
        },
      })
    ).toEqual({ valid: true });
  });

  it.each([
    [
      'merchant',
      {
        requestPublication: {
          merchantId: '7b5cb8a4-5575-456c-b936-8cdfae30db74',
          status: 'published',
        },
      },
      'merchant_mismatch',
    ],
    [
      'preload',
      { preload: { imageUrl: 'https://cdn.ogabassey.com/other.avif' } },
      'preload_mismatch',
    ],
    [
      'candidate',
      { renderedSlides: [{ id: 'other' }] },
      'rendered_candidate_mismatch',
    ],
    [
      'alt text',
      { renderedSlides: [{ imageAlt: 'Wrong alternative text' }] },
      'rendered_candidate_mismatch',
    ],
  ] as const)('rejects %s identity drift', (_label, mutation, expectedReason) => {
    const { projection, preload } = createFixture();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload:
          'preload' in mutation ? { ...preload, ...mutation.preload } : preload,
        projection,
        renderedSlides:
          'renderedSlides' in mutation
            ? [{ ...projection.candidate, ...mutation.renderedSlides[0] }]
            : [projection.candidate],
        requestPublication:
          'requestPublication' in mutation
            ? mutation.requestPublication
            : { merchantId: projection.merchantId, status: 'published' },
      })
    ).toEqual({ reason: expectedReason, valid: false });
  });

  it('rejects null expected and supplied preload identities', () => {
    const { projection } = createFixture();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload: null,
        projection,
        renderedSlides: [projection.candidate],
        requestPublication: {
          merchantId: projection.merchantId,
          status: 'published',
        },
      })
    ).toEqual({ reason: 'preload_mismatch', valid: false });
  });

  it.each([
    null,
    1,
    {},
    { version: 2 },
  ])('returns no preload identity for malformed runtime projection: %j', (projection) => {
    expect(ogabasseyHomeHeroContract.preloadIdentity(projection)).toBeNull();
  });

  it('rejects forged projection versions and malformed candidates', () => {
    const { projection, preload } = createFixture();
    for (const forged of [
      { ...projection, version: 2 },
      { ...projection, candidate: { ...projection.candidate, kind: 'promo' } },
    ]) {
      expect(
        ogabasseyHomeHeroContract.assessRenderer({
          preload,
          projection: forged as typeof projection,
          renderedSlides: [projection.candidate],
          requestPublication: {
            merchantId: projection.merchantId,
            status: 'published',
          },
        })
      ).toEqual({ reason: 'rendered_candidate_mismatch', valid: false });
    }
  });

  it.each([
    'http://cdn.ogabassey.com/core-assets/products/hero.jpg',
    'HTTPS://cdn.ogabassey.com/core-assets/products/hero.jpg',
  ])('rejects forged non-canonical candidate image URL: %s', (imageUrl) => {
    const { projection, preload } = createFixture();
    const forgedProjection = {
      ...projection,
      candidate: { ...projection.candidate, imageUrl },
    };
    expect(
      ogabasseyHomeHeroContract.preloadIdentity(forgedProjection)
    ).toBeNull();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload,
        projection: forgedProjection,
        renderedSlides: [projection.candidate],
        requestPublication: {
          merchantId: projection.merchantId,
          status: 'published',
        },
      })
    ).toEqual({ reason: 'rendered_candidate_mismatch', valid: false });
  });

  it.each([
    null,
    1,
    {},
    { version: 1 },
  ])('rejects a non-object or incomplete runtime projection: %j', (projection) => {
    const { preload } = createFixture();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload,
        projection: projection as never,
        renderedSlides: [],
        requestPublication: {
          merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
          status: 'published',
        },
      })
    ).toEqual({ reason: 'rendered_candidate_mismatch', valid: false });
  });

  it.each([
    [
      'rendered slides',
      { renderedSlides: null },
      'rendered_candidate_mismatch',
    ],
    ['publication', { requestPublication: null }, 'publication_mismatch'],
  ] as const)('rejects malformed renderer envelope: %s', (_label, mutation, reason) => {
    const { projection, preload } = createFixture();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload,
        projection,
        renderedSlides:
          'renderedSlides' in mutation
            ? (mutation.renderedSlides as never)
            : [projection.candidate],
        requestPublication:
          'requestPublication' in mutation
            ? (mutation.requestPublication as never)
            : { merchantId: projection.merchantId, status: 'published' },
      })
    ).toEqual({ reason, valid: false });
  });

  it('rejects publication and cardinality drift', () => {
    const { projection, preload } = createFixture();
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload,
        projection,
        renderedSlides: [projection.candidate],
        requestPublication: { status: 'unpublished' },
      })
    ).toEqual({ reason: 'publication_mismatch', valid: false });
    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload,
        projection,
        renderedSlides: [projection.candidate, projection.candidate],
        requestPublication: {
          merchantId: projection.merchantId,
          status: 'published',
        },
      })
    ).toEqual({ reason: 'slide_cardinality_mismatch', valid: false });
  });
});
