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

describe('filterBlogMediaPathsWithoutPersistedReferences escapes', () => {
  it('protects references serialized with JSON slash escapes', async () => {
    // Structured editor content escapes slashes; the storefront
    // parses and renders the image, so the scan must match through
    // the escapes or the path reads as unreferenced.
    const { client } = fakeClient([
      {
        data: [
          {
            content:
              '{"src":"https:\\/\\/cdn.example.com\\/media\\/platform\\/blog\\/json.webp"}',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/json.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: ['platform/blog/json.webp'],
    });
  });

  it('survives malformed escapes without losing raw matches', async () => {
    const { client } = fakeClient([
      {
        data: [
          {
            content:
              '<p>100% coverage</p><img src="https://cdn.example.com/media/platform/blog/kept.webp">',
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

  it('protects references with unicode escapes inside structured URLs', async () => {
    const { client } = fakeClient([
      {
        data: [
          {
            content:
              '{"src":"https:\\/\\/cdn.example.com\\/media\\/platform\\/blog\\/\\u0074oken.webp"}',
          },
        ],
        error: null,
      },
    ]);
    expect(
      await filterBlogMediaPathsWithoutPersistedReferences(client, [
        'platform/blog/token.webp',
        'platform/blog/orphan.webp',
      ])
    ).toEqual({
      deletable: ['platform/blog/orphan.webp'],
      skipped: ['platform/blog/token.webp'],
    });
  });
});
