import { describe, expect, it, vi } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import {
  type BlogPostMediaRow,
  filterBlogMediaPathsWithoutPersistedReferences,
} from './blog-media-reference-scan';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type PostsPage = {
  data: BlogPostMediaRow[] | null;
  error: { message: string } | null;
};

function fakeClient(pages: PostsPage[] | { throws: true }) {
  const range = vi.fn((from: number, to: number) => {
    if (!Array.isArray(pages)) return Promise.reject(new Error('down'));
    // Serve the requested window from the concatenated dataset so the
    // test proves multi-page traversal whatever the scan page size.
    const rows = pages.flatMap((page) => page.data ?? []);
    const error = pages.find((page) => page.error)?.error ?? null;
    return Promise.resolve({
      data: error ? null : rows.slice(from, to + 1),
      error,
    });
  });
  const order = vi.fn(() => ({ range }));
  const select = vi.fn(() => ({ order }));
  return {
    client: {
      from: () => ({ select }),
    } as unknown as ServerSupabaseClient,
    order,
    range,
    select,
  };
}

function fillerRows(count: number): BlogPostMediaRow[] {
  return Array.from({ length: count }, (_, index) => ({
    content: `<p>Filler post ${index}</p>`,
  }));
}

describe('filterBlogMediaPathsWithoutPersistedReferences', () => {
  it('protects paths referenced by merchant posts', async () => {
    // Merchant article content accepts sanitized HTTPS images, so a
    // merchant post can embed a public platform/blog URL. The scan
    // must cover every persisted row unfiltered: any is_platform_post
    // gate would stage the live merchant image for deletion.
    const { client, select } = fakeClient([
      {
        data: [
          {
            content:
              '<p>Merchant story</p><img src="https://cdn.example.com/media/platform/blog/shared.webp">',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/shared.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: ['platform/blog/shared.webp'],
    });
    expect(select).toHaveBeenCalledWith(
      'content, excerpt, featured_image_url, featured_image_variants, author_image_url'
    );
  });

  it('splits referenced from unreferenced paths', async () => {
    const { client } = fakeClient([
      {
        data: [
          {
            content:
              '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/kept.webp">',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/kept.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: ['platform/blog/kept.webp'],
    });
  });

  it('matches paths across media-carrying columns', async () => {
    const { client } = fakeClient([
      {
        data: [
          {
            author_image_url:
              'https://cdn.example.com/media/platform/blog/author.webp',
            content:
              '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/kept.webp">',
            excerpt: 'https://cdn.example.com/media/platform/blog/excerpt.webp',
            featured_image_url:
              'https://cdn.example.com/media/platform/blog/cover.webp',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/kept.webp',
        'platform/blog/excerpt.webp',
        'platform/blog/cover.webp',
        'platform/blog/author.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: [
        'platform/blog/kept.webp',
        'platform/blog/excerpt.webp',
        'platform/blog/cover.webp',
        'platform/blog/author.webp',
      ],
    });
  });

  it('matches paths inside variant maps and strings', async () => {
    const { client } = fakeClient([
      {
        data: [
          {
            featured_image_variants: {
              landscape_16x9:
                'https://cdn.example.com/media/platform/blog/kept/landscape_16x9.webp',
            },
          },
          {
            featured_image_variants:
              'https://cdn.example.com/media/platform/blog/raw.webp',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/kept/landscape_16x9.webp',
        'platform/blog/raw.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: [
        'platform/blog/kept/landscape_16x9.webp',
        'platform/blog/raw.webp',
      ],
    });
  });

  it('finds references beyond the first page', async () => {
    // 1,001 rows force a second page at the 1,000-row scan page size;
    // the reference sits on the last row, past the old 5,000-row
    // single-query horizon this pagination replaces.
    const { client, range } = fakeClient([
      { data: fillerRows(1000), error: null },
      {
        data: [
          {
            content:
              '<p>Late post</p><img src="https://cdn.example.com/media/platform/blog/late.webp">',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/late.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: ['platform/blog/late.webp'],
    });
    expect(range.mock.calls.length).toBeGreaterThan(1);
  });

  it('returns null when the reference scan fails', async () => {
    const failed = fakeClient([{ data: null, error: { message: 'down' } }]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(failed.client, [
        'platform/blog/orphan.webp',
      ])
    ).toBeNull();
    const thrown = fakeClient({ throws: true });
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(thrown.client, [
        'platform/blog/orphan.webp',
      ])
    ).toBeNull();
  });
});
