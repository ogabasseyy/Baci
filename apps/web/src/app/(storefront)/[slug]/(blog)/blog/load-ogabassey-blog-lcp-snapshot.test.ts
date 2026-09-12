import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { loadOgabasseyBlogLcpSnapshot } from './load-ogabassey-blog-lcp-snapshot';

vi.mock('@/lib/public-supabase-client', () => ({
  getPublicSupabaseClient: vi.fn(),
}));

const HERO_POST = {
  id: 'post-1',
  title: 'Featured listing post',
  slug: 'featured-listing-post',
  excerpt: 'Hero excerpt',
  category: 'News',
  author_name: 'Ogabassey',
  published_at: '2026-03-28T10:00:00.000Z',
  featured_image_url: 'https://cdn.example.com/hero.png',
  reading_time_minutes: 4,
};

function createListingQuery(result: { data: unknown; error: unknown }) {
  const query: {
    eq: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    range: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    neq: vi.fn(),
    not: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    select: vi.fn(),
  };

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.neq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue(result);

  return query;
}

describe('loadOgabasseyBlogLcpSnapshot', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getPublicSupabaseClient).mockReset();
  });

  it('returns the first public listing post without using cached-data', async () => {
    const query = createListingQuery({ data: [HERO_POST], error: null });
    vi.mocked(getPublicSupabaseClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof getPublicSupabaseClient>);

    const snapshot = await loadOgabasseyBlogLcpSnapshot();

    expect(snapshot).toEqual({
      basePath: 'https://ogabassey.com',
      featuredPost: {
        id: 'post-1',
        title: 'Featured listing post',
        slug: 'featured-listing-post',
        excerpt: 'Hero excerpt',
        category: 'News',
        author_name: 'Ogabassey',
        published_at: '2026-03-28T10:00:00.000Z',
        featured_image_url: 'https://cdn.example.com/hero.png',
        reading_time_minutes: 4,
      },
      imageSrc: 'https://cdn.example.com/hero.png',
      publishedDateLabel: 'Mar 28, 2026',
    });
    expect(query.range).toHaveBeenCalledWith(0, 11);
  });

  it('skips the uncached read for offline storefront builds', async () => {
    vi.stubEnv('BACI_STOREFRONT_BUILD_READS', 'offline');

    await expect(loadOgabasseyBlogLcpSnapshot()).resolves.toBeNull();
    expect(getPublicSupabaseClient).not.toHaveBeenCalled();
  });

  it('returns null when the listing query fails', async () => {
    const query = createListingQuery({
      data: null,
      error: new Error('blog_posts unavailable'),
    });
    vi.mocked(getPublicSupabaseClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof getPublicSupabaseClient>);

    await expect(loadOgabasseyBlogLcpSnapshot()).resolves.toBeNull();
  });

  it('returns null when the public listing is empty', async () => {
    const query = createListingQuery({ data: [], error: null });
    vi.mocked(getPublicSupabaseClient).mockReturnValue({
      from: vi.fn(() => query),
    } as unknown as ReturnType<typeof getPublicSupabaseClient>);

    await expect(loadOgabasseyBlogLcpSnapshot()).resolves.toBeNull();
  });
});
