import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePlatformBlog: vi.fn(),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidatePlatformBlog: mocks.revalidatePlatformBlog,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import type { createClient } from '@/lib/supabase/server';
import { verifyPatchedBlogPostMediaOrRestore } from './platform-blog-post-media-verify';
import { updatePlatformBlogPost } from './platform-blog-post-update-handler';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(args: {
  claimed?: string[];
  present: string[] | null;
  restoreErrors?: ({ message: string } | null)[];
}) {
  const claimed = args.claimed ?? [];
  const restoreErrors = [...(args.restoreErrors ?? [])];
  const state = { restored: [] as Record<string, unknown>[] };
  const client = {
    from: (table: string) => {
      if (table !== 'blog_posts' && table !== 'blog_media_delete_tombstones') {
        throw new Error(`unexpected ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            in: (_column: string, paths: string[]) =>
              Promise.resolve({
                data: paths
                  .filter((path) => claimed.includes(path))
                  .map((path) => ({ path })),
                error: null,
              }),
          }),
        }),
        update: (value: Record<string, unknown>) => {
          state.restored.push(value);
          const error = restoreErrors.length > 0 ? restoreErrors.shift() : null;
          return {
            eq: () => ({ eq: () => ({ is: () => ({ error }) }) }),
          };
        },
      };
    },
    rpc: (_name: string, rpcArgs: { p_paths: string[] }) => {
      if (args.present === null) {
        return Promise.resolve({ data: null, error: { message: 'down' } });
      }
      return Promise.resolve({
        data: rpcArgs.p_paths
          .filter((path) => (args.present as string[]).includes(path))
          .map((path) => ({ path })),
        error: null,
      });
    },
  } as unknown as ServerSupabaseClient;
  return { client, state };
}

describe('verifyPatchedBlogPostMediaOrRestore', () => {
  it('accepts the save when every referenced object still exists', async () => {
    const { client, state } = fakeClient({
      present: ['platform/blog/kept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: { content: '<p>Old</p>' },
      finalUpdateData: { content: '<p>New</p>' },
      mediaRow: {
        content:
          '<img src="https://cdn.example.com/media/platform/blog/kept.webp">',
      },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: true });
    expect(state.restored).toEqual([]);
  });

  it('restores the pre-update fields when the sweep claimed mid-save', async () => {
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: { content: '<p>Old</p>', slug: 'old-slug' },
      finalUpdateData: {
        content: '<p>New</p>',
        is_platform_post: true,
        merchant_id: null,
        slug: 'new-slug',
      },
      mediaRow: {
        content:
          '<img src="https://cdn.example.com/media/platform/blog/swept.webp">',
      },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false });
    // Only changed keys present in the pre-image restore; forced
    // scoping columns are canonical by construction, not snapshots.
    expect(state.restored).toEqual([
      { content: '<p>Old</p>', slug: 'old-slug' },
    ]);
  });

  it('retries the restore when it resolves with an error', async () => {
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      present: ['platform/blog/swept.webp'],
      restoreErrors: [{ message: 'locked' }, null],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: { content: '<p>Old</p>' },
      finalUpdateData: { content: '<p>New</p>' },
      mediaRow: {
        content:
          '<img src="https://cdn.example.com/media/platform/blog/swept.webp">',
      },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false });
    expect(state.restored).toEqual([
      { content: '<p>Old</p>' },
      { content: '<p>Old</p>' },
    ]);
  });

  it('restores when media presence is unverifiable', async () => {
    const { client, state } = fakeClient({ present: null });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: { content: '<p>Old</p>' },
      finalUpdateData: { content: '<p>New</p>' },
      mediaRow: {
        content:
          '<img src="https://cdn.example.com/media/platform/blog/shared.webp">',
      },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false });
    expect(state.restored).toEqual([{ content: '<p>Old</p>' }]);
  });
});

function patchSupabase(present: string[]) {
  const updates: Record<string, unknown>[] = [];
  const query = {
    eq: vi.fn(),
    in: vi.fn(() => Promise.resolve({ error: null })),
    is: vi.fn(),
    rpc: vi.fn((_name: string, args: { p_paths: string[] }) =>
      Promise.resolve({
        data: args.p_paths
          .filter((path) => present.includes(path))
          .map((path) => ({ path })),
        error: null,
      })
    ),
    select: vi.fn(),
    single: vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          content: '<p>Old</p>',
          id: 'post-1',
          slug: 'old-slug',
          status: 'draft',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          content:
            '<p>New</p><img src="https://cdn.example.com/media/platform/blog/swept.webp">',
          id: 'post-1',
          slug: 'new-slug',
        },
        error: null,
      }),
    update: vi.fn((value: Record<string, unknown>) => {
      updates.push(value);
      return query;
    }),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockReturnValue(query);
  return { from: vi.fn(() => query), rpc: query.rpc, updates };
}

describe('PATCH media verification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 500 and restores the pre-image when media was swept mid-save', async () => {
    const supabase = patchSupabase([]);
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        body: JSON.stringify({ content: '<p>New</p>', title: 'Updated' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Referenced media was removed during save',
    });
    expect(
      supabase.updates.some((update) => update.content === '<p>Old</p>')
    ).toBe(true);
    expect(mocks.revalidatePlatformBlog).not.toHaveBeenCalled();
  });
});
