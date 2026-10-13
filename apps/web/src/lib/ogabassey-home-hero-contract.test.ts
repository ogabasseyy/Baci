import { describe, expect, it } from 'vitest';
import { selectOgabasseyLaunchProducts } from '@/app/(storefront)/ogabassey/ogabassey-home-launch-products';
import { buildLaunchSlides } from '@/components/storefront/ogabassey/components/build-launch-slides';
import type { StorefrontHomeProduct } from '@/lib/cached-data';
import {
  type OgabasseyHomeHeroShellInput,
  ogabasseyHomeHeroContract,
} from './ogabassey-home-hero-contract';

function createRow(
  overrides: Partial<StorefrontHomeProduct> = {}
): StorefrontHomeProduct {
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
    ...overrides,
  };
}

function createPublishedShell(): Extract<
  OgabasseyHomeHeroShellInput,
  { status: 'published' }
> {
  const selectedProducts = selectOgabasseyLaunchProducts({
    launchCandidateRows: [
      createRow({
        id: 'newest',
        name: 'Newest launch',
        slug: 'newest-launch',
        created_at: '2026-07-20T12:00:00.000Z',
      }),
    ],
    pinnedProductRows: [],
  });

  return {
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    status: 'published',
    slides: buildLaunchSlides(selectedProducts, 'https://ogabassey.com'),
  };
}

describe('ogabasseyHomeHeroContract', () => {
  it('selects the exact slide-zero candidate produced by the current launch selector and renderer', () => {
    const projection = ogabasseyHomeHeroContract.project(
      createPublishedShell()
    );

    expect(projection).toMatchObject({
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      slideCount: 1,
      candidate: {
        ctaLabel: 'Shop now',
        imageAlt: 'Newest launch',
        id: 'newest',
        imageUrl: 'https://cdn.ogabassey.com/products/a27.avif',
        href: 'https://ogabassey.com/smartphones/newest-launch',
        kind: 'product',
        name: 'Newest launch',
        priceLabel: '₦50,000',
      },
    });
  });

  it('does not project a preloadable candidate for unpublished or incomplete shells', () => {
    expect(
      ogabasseyHomeHeroContract.project({
        merchantId: 'merchant-1',
        status: 'unpublished',
      })
    ).toBeNull();
    expect(
      ogabasseyHomeHeroContract.project({
        merchantId: 'merchant-1',
        status: 'published',
        slides: [],
      })
    ).toBeNull();
  });

  it.each([
    [
      'missing slides',
      { merchantId: createPublishedShell().merchantId, status: 'published' },
    ],
    [
      'missing required field',
      {
        ...createPublishedShell(),
        slides: [{ ...createPublishedShell().slides[0], name: undefined }],
      },
    ],
    [
      'invalid kind',
      {
        ...createPublishedShell(),
        slides: [{ ...createPublishedShell().slides[0], kind: 'promo' }],
      },
    ],
    [
      'non-OgaBassey image URL',
      {
        ...createPublishedShell(),
        slides: [
          {
            ...createPublishedShell().slides[0],
            imageUrl: 'https://example.com/hero.jpg',
          },
        ],
      },
    ],
    [
      'non-canonical padded image URL',
      {
        ...createPublishedShell(),
        slides: [
          {
            ...createPublishedShell().slides[0],
            imageUrl: ` ${createPublishedShell().slides[0].imageUrl} `,
          },
        ],
      },
    ],
    ...[
      'http CDN URL',
      'https://user:pass@cdn.ogabassey.com/core-assets/products/hero.jpg',
      'https://cdn.ogabassey.com:8443/core-assets/products/hero.jpg',
      'https://cdn.ogabassey.com/core-assets/blog/hero.jpg',
    ].map(
      (label) =>
        [
          label,
          {
            ...createPublishedShell(),
            slides: [
              {
                ...createPublishedShell().slides[0],
                imageUrl:
                  label === 'http CDN URL'
                    ? 'http://cdn.ogabassey.com/core-assets/products/hero.jpg'
                    : label,
              },
            ],
          },
        ] as const
    ),
  ] as const)('rejects malformed published shell: %s', (_label, shell) => {
    expect(
      ogabasseyHomeHeroContract.project(
        shell as unknown as OgabasseyHomeHeroShellInput
      )
    ).toBeNull();
  });

  it.each([
    'merchant-1',
    ' 6b5cb8a4-5575-456c-b936-8cdfae30db74 ',
    '6b5cb8a4-5575-456c-b936-8cdfae30db74\n',
    '6B5CB8A4-5575-456C-B936-8CDFAE30DB74',
  ])('rejects malformed bound merchant ID: %s', (merchantId) => {
    expect(
      ogabasseyHomeHeroContract.project({
        ...createPublishedShell(),
        merchantId,
      })
    ).toBeNull();
  });

  it('derives a stable preload identity from the exact candidate rather than a separate image input', () => {
    const projection = ogabasseyHomeHeroContract.project(
      createPublishedShell()
    );
    if (!projection) {
      throw new Error('expected a published projection');
    }

    const preload = ogabasseyHomeHeroContract.preloadIdentity(projection);
    if (!preload) {
      throw new Error('expected a CDN preload projection');
    }

    expect(preload).toMatchObject({
      fetchPriority: 'high',
      href: expect.stringContaining('format=avif'),
      imageSizes: '(max-width: 767px) 40vw, 50vw',
      imageSrcSet: expect.stringContaining('format=avif'),
      imageUrl: projection.candidate.imageUrl,
      media: '(max-width: 767px)',
      quality: 70,
      type: 'image/avif',
    });
    expect(preload.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('allows an external image on a later slide while requiring CDN slide zero', () => {
    const shell = createPublishedShell();
    const projection = ogabasseyHomeHeroContract.project({
      ...shell,
      slides: [
        shell.slides[0],
        {
          ...shell.slides[0],
          id: 'second',
          imageUrl: 'https://images.example/second.jpg',
        },
      ],
    });
    expect(projection?.slideCount).toBe(2);
  });

  it('rejects stale published cache data when the request-scoped verdict is unpublished', () => {
    const projection = ogabasseyHomeHeroContract.project(
      createPublishedShell()
    );
    if (!projection) {
      throw new Error('expected a published projection');
    }
    const preload = ogabasseyHomeHeroContract.preloadIdentity(projection);

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
        renderedSlides: [projection.candidate],
        requestPublication: { status: 'unbound' },
      })
    ).toEqual({ reason: 'publication_mismatch', valid: false });
  });

  it.each([
    ['kind', 'promo'],
    ['priceLabel', '₦50,001'],
    ['ctaLabel', 'Pre-order now'],
    ['name', 'Drifted name'],
    ['imageAlt', 'Drifted alt'],
    ['href', 'https://ogabassey.com/drifted'],
    ['imageUrl', 'https://cdn.ogabassey.com/drifted.avif'],
    ['id', 'drifted-id'],
  ] as const)('rejects slide-zero %s drift', (field, value) => {
    const projection = ogabasseyHomeHeroContract.project(
      createPublishedShell()
    );
    if (!projection) {
      throw new Error('expected a published projection');
    }

    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload: ogabasseyHomeHeroContract.preloadIdentity(projection),
        projection,
        renderedSlides: [{ ...projection.candidate, [field]: value }],
        requestPublication: {
          merchantId: projection.merchantId,
          status: 'published',
        },
      })
    ).toEqual({ reason: 'rendered_candidate_mismatch', valid: false });
  });

  it('rejects rendered slide cardinality drift even when slide zero matches', () => {
    const projection = ogabasseyHomeHeroContract.project(
      createPublishedShell()
    );
    if (!projection) {
      throw new Error('expected a published projection');
    }

    expect(
      ogabasseyHomeHeroContract.assessRenderer({
        preload: ogabasseyHomeHeroContract.preloadIdentity(projection),
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
