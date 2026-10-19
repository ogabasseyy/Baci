import { describe, expect, it } from 'vitest';
import type { ImageManifestMap } from '../google-merchant/feed-builder';
import type { OpenAIFeedVariant } from './feed-data';
import type { Product } from './feed-types';
import { resolveLegacyFeedImages } from './legacy-feed-images';

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'product-1',
    name: 'Test Phone',
    description: '<p>A strong phone</p>',
    slug: 'test-phone',
    price: 50_000,
    images: ['https://cdn.example.com/phone.jpg'],
    stock: 5,
    ...overrides,
  };
}

function variant(
  overrides: Partial<OpenAIFeedVariant> = {}
): OpenAIFeedVariant {
  return {
    id: 'variant-1',
    attributes: { color: 'Red' },
    ...overrides,
  };
}

function manifest(entries: ImageManifestMap[string]): ImageManifestMap {
  return { 'product-1': entries };
}

describe('resolveLegacyFeedImages', () => {
  it('resolves manifest primary and additional links', () => {
    expect(
      resolveLegacyFeedImages(
        product(),
        undefined,
        manifest([
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/manifest-side.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 1,
          },
        ])
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/manifest-front.jpg',
      additional_image_links: ['https://cdn.example.com/manifest-side.jpg'],
    });
  });

  it('falls back to product-level entries when a variant has no primary', () => {
    expect(
      resolveLegacyFeedImages(
        product(),
        variant(),
        manifest([
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
        ])
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/manifest-front.jpg',
      additional_image_links: [],
    });
  });

  it('prefers variant entries when the variant has its own primary', () => {
    expect(
      resolveLegacyFeedImages(
        product(),
        variant(),
        manifest([
          {
            variant_id: 'variant-1',
            verified_url: 'https://cdn.example.com/manifest-red.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 1,
          },
        ])
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/manifest-red.jpg',
      additional_image_links: [],
    });
  });

  it('excludes offer-claimed URLs from manifest and raw fallbacks', () => {
    expect(
      resolveLegacyFeedImages(
        product({
          images: ['https://cdn.example.com/manifest-front.jpg'],
          offers: [{ images: ['https://cdn.example.com/manifest-front.jpg'] }],
        }),
        undefined,
        manifest([
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
        ])
      )
    ).toEqual({ image_link: '', additional_image_links: [] });
  });

  it('falls back to raw product images without offers', () => {
    expect(resolveLegacyFeedImages(product(), undefined, {})).toEqual({
      image_link: 'https://cdn.example.com/phone.jpg',
      additional_image_links: [],
    });
  });

  it('prefers the variant primary image over the raw fallback', () => {
    expect(
      resolveLegacyFeedImages(
        product(),
        variant({ primary_image: 'https://cdn.example.com/red.jpg' }),
        {}
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/red.jpg',
      additional_image_links: [],
    });
  });

  it('falls back to the product manifest primary when the variant primary is claimed', () => {
    expect(
      resolveLegacyFeedImages(
        product({
          images: ['https://cdn.example.com/phone.jpg'],
          offers: [{ images: ['https://cdn.example.com/manifest-red.jpg'] }],
        }),
        variant(),
        manifest([
          {
            variant_id: 'variant-1',
            verified_url: 'https://cdn.example.com/manifest-red.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 1,
          },
        ])
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/manifest-front.jpg',
      additional_image_links: [],
    });
  });

  it('falls back to product-level entries rather than a sibling image', () => {
    expect(
      resolveLegacyFeedImages(
        product(),
        variant(),
        manifest([
          {
            variant_id: 'variant-2',
            verified_url: 'https://cdn.example.com/sibling.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/manifest-front.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 1,
          },
        ])
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/manifest-front.jpg',
      additional_image_links: [],
    });
  });

  it('excludes an offer-claimed variant primary image', () => {
    expect(
      resolveLegacyFeedImages(
        product({
          images: ['https://cdn.example.com/phone.jpg'],
          offers: [{ images: ['/images/red.jpg'] }],
        }),
        variant({ primary_image: 'https://cdn.example.com/images/red.jpg' }),
        {}
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/phone.jpg',
      additional_image_links: [],
    });
  });

  it('promotes the first unclaimed raw image when images[0] is claimed', () => {
    expect(
      resolveLegacyFeedImages(
        product({
          images: [
            'https://cdn.example.com/claimed.jpg',
            'https://cdn.example.com/safe.jpg',
          ],
          offers: [{ images: ['https://cdn.example.com/claimed.jpg'] }],
        }),
        undefined,
        {}
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/safe.jpg',
      additional_image_links: [],
    });
  });

  it('restricts product rows to product-level entries', () => {
    expect(
      resolveLegacyFeedImages(
        product(),
        undefined,
        manifest([
          {
            variant_id: 'variant-1',
            verified_url: 'https://cdn.example.com/variant-1.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: true,
            position: 0,
          },
          {
            verified_url: 'https://cdn.example.com/product-1.jpg',
            verified_format: 'jpeg',
            status: 'verified',
            is_primary: false,
            position: 1,
          },
        ])
      )
    ).toEqual({
      image_link: 'https://cdn.example.com/product-1.jpg',
      additional_image_links: [],
    });
  });
});
