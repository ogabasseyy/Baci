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

describe('parseReviewHandoff', () => {
  it.each(['4', '12', '0'])('rejects unresolved image slot %s', (slot) => {
    expect(() =>
      parseReviewHandoff({
        ...validHandoff,
        content_html: `{{INLINE_IMAGE_${slot}}}`,
      })
    ).toThrow('unresolved');
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '1200',
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
    ['focus_keyword', 50],
    ['seo_title', 70],
    ['seo_description', 160],
    ['excerpt', 300],
    ['category', 100],
    ['intent_source', 100],
  ] as const)('validates the server limit for %s', (field, limit) => {
    expect(() =>
      parseReviewHandoff({ ...validHandoff, [field]: 'x'.repeat(limit) })
    ).not.toThrow();
    expect(() =>
      parseReviewHandoff({ ...validHandoff, [field]: 'x'.repeat(limit + 1) })
    ).toThrow();
  });
  it('maps a completed handoff into an unsaved draft regardless of artifact status', () => {
    expect(parseReviewHandoff(validHandoff)).toMatchObject({
      author_name: 'Baci Editorial',
      category: 'Smartphones',
      content: '<p>Choose a Galaxy A phone.</p>',
      featured_image_url: 'https://cdn.example.com/galaxy-a.webp',
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: {
        landscape_16x9: managedVariant,
      },
      focus_keyword: 'Galaxy A buyer guide',
      intent: 'buying-guide',
      intent_source: 'draft_task_type',
      seo_description: 'Compare current Galaxy A options.',
      slug: 'galaxy-a-buyer-guide',
      status: 'draft',
      tags: 'Samsung, Buying Guides',
      title: 'Galaxy A buyer guide',
    });
  });

  it('rejects artifacts without the explicit handoff schema version', () => {
    expect(() =>
      parseReviewHandoff({ ...validHandoff, schema_version: 'v0' })
    ).toThrow('Unsupported review handoff format');
  });

  it('rejects local image paths and unresolved inline-image placeholders', () => {
    expect(() =>
      parseReviewHandoff({
        ...validHandoff,
        content_html: '<p>Intro</p>{{INLINE_IMAGE_1}}',
      })
    ).toThrow('unresolved inline image placeholders');

    expect(() =>
      parseReviewHandoff({
        ...validHandoff,
        featured_image: { path: 'assets/featured.png', alt: 'Cover' },
      })
    ).toThrow('HTTPS featured-image URL');
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

  it('rejects oversized or incomplete untrusted objects', () => {
    expect(() =>
      parseReviewHandoff({
        ...validHandoff,
        content_html: 'x'.repeat(1_000_001),
      })
    ).toThrow('content exceeds the import limit');

    expect(() =>
      parseReviewHandoff({ ...validHandoff, content_html: '' })
    ).toThrow('title and article content are required');
  });
});
