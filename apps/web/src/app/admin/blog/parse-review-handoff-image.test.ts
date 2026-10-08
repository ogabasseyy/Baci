import { describe, expect, it } from 'vitest';
import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { parseReviewHandoff } from './parse-review-handoff';

const managedVariant = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover/landscape_16x9.webp`;
const validHandoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  status: 'published',
  title: 'Galaxy A buyer guide',
  content_html: '<p>Choose a Galaxy A phone.</p>',
  excerpt: 'A practical guide.',
  category: 'Smartphones',
  seo_title: 'Galaxy A buyer guide',
  seo_description: 'Compare current Galaxy A options.',
  focus_keyword: 'Galaxy A buyer guide',
  tags: ['Samsung', 'Buying Guides'],
  intent: 'buying-guide',
  intent_source: 'draft_task_type',
  featured_image: {
    url: 'https://cdn.example.com/galaxy-a.webp',
    alt: 'Galaxy A phones',
    width: 1200,
    height: 675,
    variants: {
      landscape_16x9: managedVariant,
    },
  },
};

describe('parseReviewHandoff featured image', () => {
  it('marks imported alt text as not hand-edited', () => {
    expect(parseReviewHandoff(validHandoff)).toMatchObject({
      featured_image_alt: 'Galaxy A phones',
      featured_image_alt_edited: false,
    });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    2_147_483_648,
    Number.MAX_SAFE_INTEGER,
    'abc',
    '1.5',
    '0x10',
    '1e3',
    '0b11',
    '',
    '  ',
    null,
  ])('clears invalid image dimensions %s', (dimension) => {
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          width: dimension,
          height: dimension,
        },
      })
    ).toMatchObject({
      featured_image_width: null,
      featured_image_height: null,
    });
  });

  it.each([
    [1, 1],
    [1200, 1200],
    [2_147_483_647, 2_147_483_647],
    ['1', 1],
    ['1200', 1200],
    [' 1200 ', 1200],
  ] as const)('preserves database-safe image dimensions %s', (dimension, expected) => {
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          width: dimension,
          height: dimension,
        },
      })
    ).toMatchObject({
      featured_image_width: expected,
      featured_image_height: expected,
    });
  });

  it('keeps only supported managed image variants from the handoff', () => {
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          variants: {
            landscape_16x9: managedVariant,
            attacker_field: 'https://cdn.example.com/extra.webp',
            square_1x1: 'javascript:alert(1)',
          },
        },
      }).featured_image_variants
    ).toEqual({
      landscape_16x9: managedVariant,
    });
  });

  it.each([
    'https://cdn.example.com/media/platform/blog/cover/landscape_16x9.webp',
    `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/unmanaged/landscape_16x9.webp`,
    `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/merchant-id/blog/cover/landscape_16x9.webp`,
  ])('discards variants that the platform save API rejects: %s', (url) => {
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          variants: { landscape_16x9: url },
        },
      }).featured_image_variants
    ).toEqual({});
  });

  it('drops a managed variant from a different upload than the source', () => {
    // The variant is validly managed but belongs to another upload
    // token; keeping it would display an unrelated image in responsive
    // layouts.
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          url: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/aaaa.jpg`,
          variants: {
            landscape_16x9: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/bbbb/landscape_16x9.webp`,
          },
        },
      }).featured_image_variants
    ).toEqual({});
  });

  it('keeps a managed variant sharing the source upload token', () => {
    const variant = `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/aaaa/landscape_16x9.webp`;
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          url: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/aaaa.jpg`,
          variants: { landscape_16x9: variant },
        },
      }).featured_image_variants
    ).toEqual({ landscape_16x9: variant });
  });

  it('drops managed variants with null bytes hidden in the query string', () => {
    const nul = String.fromCharCode(0);
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          variants: {
            landscape_16x9: `${managedVariant}?token=${nul}`,
            square_1x1: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover/square_1x1.webp`,
          },
        },
      }).featured_image_variants
    ).toEqual({
      square_1x1: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover/square_1x1.webp`,
    });
  });

  it('drops managed variants with unpaired surrogates in the URL', () => {
    const high = String.fromCharCode(0xd800);
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          variants: {
            landscape_16x9: `${managedVariant}?token=${high}`,
            square_1x1: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover/square_1x1.webp`,
          },
        },
      }).featured_image_variants
    ).toEqual({
      square_1x1: `${DEFAULT_BLOG_MEDIA_CDN_ORIGIN}/media/platform/blog/cover/square_1x1.webp`,
    });
  });

  it('validates the server alt-text limit before importing', () => {
    const handoff = (length: number) => ({
      ...validHandoff,
      featured_image: {
        ...validHandoff.featured_image,
        alt: 'x'.repeat(length),
      },
    });
    expect(parseReviewHandoff(handoff(200)).featured_image_alt).toHaveLength(
      200
    );
    expect(() => parseReviewHandoff(handoff(201))).toThrow();
  });
});
