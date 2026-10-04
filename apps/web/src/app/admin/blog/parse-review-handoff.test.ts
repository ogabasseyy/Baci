import { describe, expect, it } from 'vitest';
import { parseReviewHandoff } from './parse-review-handoff';

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
      landscape_16x9: 'https://cdn.example.com/galaxy-a-landscape.webp',
    },
  },
};

describe('parseReviewHandoff', () => {
  it('maps a completed handoff into an unsaved draft regardless of artifact status', () => {
    expect(parseReviewHandoff(validHandoff)).toMatchObject({
      author_name: 'Baci Editorial',
      category: 'Smartphones',
      content: '<p>Choose a Galaxy A phone.</p>',
      featured_image_url: 'https://cdn.example.com/galaxy-a.webp',
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: {
        landscape_16x9: 'https://cdn.example.com/galaxy-a-landscape.webp',
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
    ).toThrow('public featured-image URL');
  });

  it('keeps only supported HTTPS image variants from the handoff', () => {
    expect(
      parseReviewHandoff({
        ...validHandoff,
        featured_image: {
          ...validHandoff.featured_image,
          variants: {
            landscape_16x9: 'https://cdn.example.com/landscape.webp',
            attacker_field: 'https://cdn.example.com/extra.webp',
            square_1x1: 'javascript:alert(1)',
          },
        },
      }).featured_image_variants
    ).toEqual({
      landscape_16x9: 'https://cdn.example.com/landscape.webp',
    });
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
