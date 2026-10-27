import type {
  BuildProductSemanticModelInput,
  ProductSemanticCandidate,
} from './product-semantic-types';

export function makeCandidate(
  overrides: Partial<ProductSemanticCandidate> &
    Pick<ProductSemanticCandidate, 'slug' | 'name' | 'price'>
): ProductSemanticCandidate {
  return {
    brand: null,
    condition: 'new',
    stock: 5,
    category_slug: 'smartphones',
    product_key_specs: {},
    ...overrides,
  };
}

export function makeInput(
  overrides: Partial<BuildProductSemanticModelInput> &
    Pick<BuildProductSemanticModelInput, 'currentProduct' | 'inventory'>
): BuildProductSemanticModelInput {
  return {
    storeUrl: 'https://ogabassey.com',
    merchantBusinessName: 'Ogabassey',
    categorySlug: 'smartphones',
    categoryName: 'Smartphones',
    ...overrides,
  };
}

export const publishedGuidePosts = [
  {
    slug: 'best-phones-in-nigeria',
    title: 'Best Phones in Nigeria',
    excerpt: 'Budget and flagship phone picks.',
    category: 'Smartphones',
    tags: ['smartphones', 'budget', 'iphone'],
    keywords: ['android', 'battery'],
    featured_image_url: null,
    published_at: '2026-04-10T09:00:00.000Z',
    reading_time_minutes: 6,
  },
  {
    slug: 'apple-vs-samsung-buying-guide',
    title: 'Apple vs Samsung Buying Guide',
    excerpt: 'Which ecosystem fits you.',
    category: 'Smartphones',
    tags: ['smartphones', 'apple', 'samsung'],
    keywords: ['iphone', 'galaxy'],
    featured_image_url: null,
    published_at: '2026-04-09T09:00:00.000Z',
    reading_time_minutes: 5,
  },
];
