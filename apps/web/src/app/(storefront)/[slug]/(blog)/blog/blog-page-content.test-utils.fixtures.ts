import { BLOG_LISTING_PAGE_SIZE } from '@/lib/blog-listing-page-size';

export const merchant = {
  id: 'merchant-1',
  business_name: 'Ogabassey',
  slug: 'test-store',
  custom_domain: undefined as string | undefined,
  store_url: undefined as string | undefined,
  logo_url: '',
  template_id: 'ogabassey',
  country: 'NG' as string | undefined,
  social_media: { instagram: '@ogabassey' } as
    | { instagram?: string; facebook?: string; twitter?: string }
    | undefined,
};

export const postsPayload = [
  {
    id: 'post-1',
    title: 'First Post',
    slug: 'first-post',
    excerpt: 'Latest store updates',
    featured: false,
    featured_image_url: 'https://cdn.example.com/blog-cover.png',
    featured_image_variants: {
      landscape_16x9: 'https://cdn.example.com/blog-cover-16x9.png',
      standard_4x3: 'https://cdn.example.com/blog-cover-4x3.png',
      square_1x1: 'https://cdn.example.com/blog-cover-1x1.png',
    },
    featured_image_alt: 'First Post cover',
    category: 'News',
    tags: ['launch'],
    author_name: 'Ogabassey',
    published_at: '2026-03-28T10:00:00.000Z',
    reading_time_minutes: 4,
    view_count: 10,
  },
];

export const clusterCollections = [
  {
    categorySlug: 'smartphones',
    heading: 'Smartphone buying guides',
    categoryHref: 'https://ogabassey.com/smartphones',
    guides: [
      {
        href: 'https://ogabassey.com/blog/best-phones-in-nigeria',
        title: 'Best Phones in Nigeria',
        description: 'Budget and flagship picks.',
        kind: 'best-in-nigeria' as const,
      },
      {
        href: 'https://ogabassey.com/blog/apple-vs-samsung-buying-guide',
        title: 'Apple vs Samsung Buying Guide',
        description: 'Which ecosystem fits you.',
        kind: 'decision-support' as const,
      },
    ],
  },
];

export function buildListingResult(
  overrides?: Partial<{
    merchant: typeof merchant;
    posts: typeof postsPayload;
    totalPosts: number;
  }>
) {
  const posts = overrides?.posts ?? postsPayload;
  const totalPosts = overrides?.totalPosts ?? posts.length;
  return {
    merchant: overrides?.merchant ?? merchant,
    posts,
    totalPosts,
    categories: ['News', 'gcrblw'],
    currentPage: 1,
    totalPages: Math.ceil(totalPosts / BLOG_LISTING_PAGE_SIZE),
    searchQuery: undefined,
  };
}
