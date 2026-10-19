import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updatePlatformBlogPost } from './blog-api';
import type {
  PlatformAdminBlogFormState,
  PlatformAdminBlogPostDetail,
} from './blog-types';

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mockFetchWithCsrf }));

const sampleForm: PlatformAdminBlogFormState = {
  author_name: 'Baci Editorial',
  category: '',
  content: 'Hello world',
  excerpt: '',
  featured_image_alt: 'Hero image alt',
  featured_image_height: 675,
  featured_image_url: 'https://cdn.example.com/platform/blog/source.webp',
  featured_image_variants: {
    landscape_16x9: 'https://cdn.example.com/platform/blog/landscape_16x9.webp',
    square_1x1: 'https://cdn.example.com/platform/blog/square_1x1.webp',
  },
  featured_image_width: 1200,
  seo_description: '',
  seo_title: '',
  slug: '',
  status: 'draft',
  tags: '',
  title: 'Launch Faster',
};

const existingPost: PlatformAdminBlogPostDetail = {
  author_name: sampleForm.author_name,
  category: sampleForm.category || null,
  content: sampleForm.content,
  excerpt: sampleForm.excerpt || null,
  featured_image_alt: sampleForm.featured_image_alt || null,
  featured_image_height: sampleForm.featured_image_height,
  featured_image_url: sampleForm.featured_image_url,
  featured_image_variants: sampleForm.featured_image_variants,
  featured_image_width: sampleForm.featured_image_width,
  id: 'post-1',
  published_at: null,
  seo_description: sampleForm.seo_description || null,
  seo_title: sampleForm.seo_title || null,
  slug: 'launch-faster',
  status: 'draft',
  tags: [],
  title: sampleForm.title,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('blog-api featured image mutations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resets featured metadata when url changes without new metadata', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
        category: '',
        excerpt: '',
        featured_image_alt: '',
        seo_description: '',
        seo_title: '',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.category).toBeNull();
    expect(body.excerpt).toBeNull();
    expect(body.featured_image_alt).toBeNull();
    expect(body.seo_description).toBeNull();
    expect(body.seo_title).toBeNull();
    expect(body.featured_image_height).toBeNull();
    expect(body.featured_image_width).toBeNull();
    expect(body.featured_image_variants).toEqual({});
  });

  it('preserves fresh alt text when url changes without new dimensions', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_alt: 'New cover description',
        featured_image_alt_edited: true,
        featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.featured_image_url).toBe(
      'https://cdn.example.com/platform/blog/new.webp'
    );
    expect(body.featured_image_alt).toBe('New cover description');
    expect(body.featured_image_height).toBeNull();
    expect(body.featured_image_width).toBeNull();
    expect(body.featured_image_variants).toEqual({});
  });

  it('clears emptied alt text when url changes without new metadata', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_alt: '',
        featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.featured_image_alt).toBeNull();
  });

  it('preserves stored alt text when a url edit is undone', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_alt: '',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;
    expect(body.featured_image_alt).toBe('Hero image alt');
  });

  it('keeps featured metadata when url and metadata change together', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        featured_image_height: 900,
        featured_image_url: 'https://cdn.example.com/platform/blog/new.webp',
        featured_image_variants: {
          landscape_16x9:
            'https://cdn.example.com/platform/blog/new/landscape_16x9.webp',
        },
        featured_image_width: 1600,
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;

    expect(body.featured_image_alt).toBeNull();
    expect(body.featured_image_height).toBe(900);
    expect(body.featured_image_width).toBe(1600);
    expect(body.featured_image_variants).toEqual({
      landscape_16x9:
        'https://cdn.example.com/platform/blog/new/landscape_16x9.webp',
    });
  });

  it('omits featured image metadata when image fields are unchanged', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ id: 'post-1', slug: 'launch-faster' })
    );

    await updatePlatformBlogPost(
      'post-1',
      {
        ...sampleForm,
        category: 'Phones',
        excerpt: 'Updated excerpt',
      },
      existingPost
    );

    const [, options] = mockFetchWithCsrf.mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(String(options.body)) as Record<string, unknown>;

    expect(Object.hasOwn(body, 'featured_image_url')).toBe(false);
    expect(Object.hasOwn(body, 'featured_image_width')).toBe(false);
    expect(Object.hasOwn(body, 'featured_image_height')).toBe(false);
    expect(Object.hasOwn(body, 'featured_image_variants')).toBe(false);
    expect(body.category).toBe('Phones');
    expect(body.excerpt).toBe('Updated excerpt');
  });
});
