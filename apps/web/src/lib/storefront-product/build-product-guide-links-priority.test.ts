import { describe, expect, it } from 'vitest';
import { buildProductGuideLinks } from './build-product-guide-links';
import type { BuildProductSemanticModelInput } from './product-semantic-types';

function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> = {}
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    currentProduct: {
      id: 'prod-iphone-16',
      slug: 'iphone-16',
      name: 'iPhone 16',
      price: 1_200_000,
      brand: 'Apple',
      condition: 'new',
      stock: 5,
      category_slug: 'smartphones',
    },
    inventory: [],
    ...overrides,
  };
}

function makeV2Post(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'v2-guide',
    title: 'V2 Guide',
    excerpt: null,
    category: 'Smartphones',
    tags: [] as string[],
    keywords: [] as string[],
    featured_image_url: null,
    published_at: '2026-03-01T00:00:00Z',
    reading_time_minutes: 5,
    metadata_status: 'verified' as const,
    metadata_contract_version: 2,
    metadata_source_revision: 'rev-v2-1',
    cluster_category_slug: 'smartphones',
    applicable_brands: [] as string[],
    ...overrides,
  };
}

describe('buildProductGuideLinks priority ordering and mixed-mode ranking (§2.5)', () => {
  it('ranks eligible v2 posts ahead of legacy fallback posts in mixed mode', () => {
    const v2SubjectPost = makeV2Post({
      slug: 'iphone-16-v2-guide',
      title: 'iPhone 16 Official V2 Guide',
      tags: ['apple'],
      keywords: ['buyer-guide'],
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      subjects: [
        { productId: 'prod-iphone-16', subjectRole: 'primary' as const },
      ],
    });

    const legacyInferredPost = {
      slug: 'legacy-iphone-buying-guide',
      title: 'Legacy Inferred iPhone Buying Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: ['apple', 'buying-guide'],
      keywords: ['buyer-guide'],
      featured_image_url: null,
      published_at: '2026-01-01T00:00:00Z',
      reading_time_minutes: 4,
    };

    const links = buildProductGuideLinks(
      makeInput({
        guidePosts: [v2SubjectPost, legacyInferredPost],
      })
    );

    // Verified V2 post comes first, followed by eligible legacy fallback
    expect(links).toHaveLength(2);
    expect(links[0].href).toBe('https://ogabassey.com/blog/iphone-16-v2-guide');
    expect(links[1].href).toBe(
      'https://ogabassey.com/blog/legacy-iphone-buying-guide'
    );
  });

  it('orders v2 candidates by priority slug first, then matchPriority (subject > brand > category)', () => {
    const categoryGuide = makeV2Post({
      slug: 'smartphones-category-guide',
      title: 'All Smartphones Guide',
      published_at: '2026-03-10T00:00:00Z',
      reading_time_minutes: 4,
      guide_scope: 'category_guide',
      guide_kind: 'buyer-guide',
    });

    const brandGuide = makeV2Post({
      slug: 'apple-brand-guide',
      title: 'Apple Brand Guide',
      published_at: '2026-03-05T00:00:00Z',
      guide_scope: 'brand_family_guide',
      guide_kind: 'best-in-nigeria',
      applicable_brands: ['apple'],
    });

    const subjectGuide = makeV2Post({
      slug: 'iphone-16-subject-guide',
      title: 'iPhone 16 Subject Guide',
      published_at: '2026-03-01T00:00:00Z',
      reading_time_minutes: 6,
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      subjects: [
        { productId: 'prod-iphone-16', subjectRole: 'primary' as const },
      ],
    });

    // 1. Without priorityGuidePostSlugs: matchPriority rules (subject = 1, brand = 2, category = 3)
    const linksNaturalOrder = buildProductGuideLinks(
      makeInput({
        guidePosts: [categoryGuide, brandGuide, subjectGuide],
      })
    );
    expect(linksNaturalOrder.map((l) => l.href)).toEqual([
      'https://ogabassey.com/blog/iphone-16-subject-guide',
      'https://ogabassey.com/blog/apple-brand-guide',
      'https://ogabassey.com/blog/smartphones-category-guide',
    ]);

    // 2. With priorityGuidePostSlugs pointing to categoryGuide: priority slug wins
    const linksWithPriority = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [categoryGuide.slug],
        guidePosts: [categoryGuide, brandGuide, subjectGuide],
      })
    );
    expect(linksWithPriority.map((l) => l.href)).toEqual([
      'https://ogabassey.com/blog/smartphones-category-guide',
      'https://ogabassey.com/blog/iphone-16-subject-guide',
      'https://ogabassey.com/blog/apple-brand-guide',
    ]);
  });

  it('exercises transitional branch with verified V2 post, priority metadata-free post, and non-priority legacy post', () => {
    const verifiedV2Post = makeV2Post({
      slug: 'iphone-16-v2-verified',
      title: 'iPhone 16 Verified Guide',
      tags: ['apple'],
      keywords: ['buyer-guide'],
      guide_scope: 'product_specific',
      guide_kind: 'buyer-guide',
      subjects: [
        { productId: 'prod-iphone-16', subjectRole: 'primary' as const },
      ],
    });

    const priorityMetadataFreePost = {
      slug: 'iphone-16-priority-product-link',
      title: 'iPhone 16 Linked Product Buying Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: ['apple', 'buying-guide'],
      keywords: ['buying guide'],
      featured_image_url: null,
      published_at: '2026-02-01T00:00:00Z',
      reading_time_minutes: 4,
    };

    const nonPriorityLegacyPost = {
      slug: 'unrelated-general-phones-guide',
      title: 'General Phones Inferred Guide',
      excerpt: null,
      category: 'Smartphones',
      tags: ['smartphones'],
      keywords: ['buyer-guide'],
      featured_image_url: null,
      published_at: '2026-01-01T00:00:00Z',
      reading_time_minutes: 3,
    };

    const links = buildProductGuideLinks(
      makeInput({
        priorityGuidePostSlugs: [priorityMetadataFreePost.slug],
        guidePosts: [
          nonPriorityLegacyPost,
          verifiedV2Post,
          priorityMetadataFreePost,
        ],
      })
    );

    expect(links.map((l) => l.href)).toEqual([
      'https://ogabassey.com/blog/iphone-16-priority-product-link',
      'https://ogabassey.com/blog/iphone-16-v2-verified',
    ]);
  });
});
