import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  current?: Record<string, unknown> | null;
  present: string[] | null;
  restoreErrors?: ({ message: string } | null)[];
  restoreRows?: { id: string }[];
}) {
  const claimed = args.claimed ?? [];
  const restoreErrors = [...(args.restoreErrors ?? [])];
  const state = {
    eqCalls: [] as [string, unknown][],
    restored: [] as Record<string, unknown>[],
  };
  const query = {
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    update: vi.fn(),
  };
  query.eq.mockImplementation((column: string, value: unknown) => {
    state.eqCalls.push([column, value]);
    return query;
  });
  query.is.mockReturnValue(query);
  query.in.mockImplementation((_column: string, paths: string[]) =>
    Promise.resolve({
      data: paths
        .filter((path) => claimed.includes(path))
        .map((path) => ({ path })),
      error: null,
    })
  );
  query.select.mockImplementation((columns: string) => {
    // Guard pre-reads select many columns and end in single(); the
    // restore write selects only the id for its affected-row check.
    if (columns !== 'id') return query;
    const error = restoreErrors.length > 0 ? restoreErrors.shift() : null;
    return Promise.resolve({
      data: error ? null : (args.restoreRows ?? [{ id: 'post-1' }]),
      error,
    });
  });
  query.single.mockImplementation(() =>
    Promise.resolve({
      data: args.current === undefined ? null : args.current,
      error: args.current == null ? { message: 'no row' } : null,
    })
  );
  query.update.mockImplementation((value: Record<string, unknown>) => {
    state.restored.push(value);
    return query;
  });
  const client = {
    from: (table: string) => {
      if (table !== 'blog_posts' && table !== 'blog_media_delete_tombstones') {
        throw new Error(`unexpected ${table}`);
      }
      return query;
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

const SWEPT_MEDIA_ROW = {
  content: '<img src="https://cdn.example.com/media/platform/blog/swept.webp">',
};

describe('verifyPatchedBlogPostMediaOrRestore', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  it('accepts the save when every referenced object still exists', async () => {
    const { client, state } = fakeClient({
      present: ['platform/blog/kept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      expectedUpdatedAt: 'ts-a',
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
      current: {
        content: '<p>New</p>',
        is_platform_post: true,
        merchant_id: null,
        slug: 'new-slug',
        updated_at: 'ts-a',
      },
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      expectedUpdatedAt: 'ts-a',
      existingPost: { content: '<p>Old</p>', slug: 'old-slug' },
      finalUpdateData: {
        content: '<p>New</p>',
        is_platform_post: true,
        merchant_id: null,
        slug: 'new-slug',
      },
      mediaRow: SWEPT_MEDIA_ROW,
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    // Only changed keys present in the pre-image restore; forced
    // scoping columns are canonical by construction, not snapshots.
    expect(state.restored).toEqual([
      { content: '<p>Old</p>', slug: 'old-slug' },
    ]);
    expect(state.eqCalls).toContainEqual(['updated_at', 'ts-a']);
  });

  it('skips the restore when an intervening update changed a field', async () => {
    // Tab B saved after tab A and re-verified its own content, so
    // restoring tab A's snapshot would resurrect broken media over a
    // valid post.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: {
        content: '<p>Bee</p>',
        is_platform_post: true,
        merchant_id: null,
        slug: 'new-slug',
        updated_at: 'ts-b',
      },
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      expectedUpdatedAt: 'ts-a',
      existingPost: { content: '<p>Old</p>', slug: 'old-slug' },
      finalUpdateData: {
        content: '<p>New</p>',
        is_platform_post: true,
        merchant_id: null,
        slug: 'new-slug',
      },
      mediaRow: SWEPT_MEDIA_ROW,
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: false });
    expect(state.restored).toEqual([]);
  });

  it('reports unrelieved when the guarded write affects no rows', async () => {
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: {
        content: '<p>New</p>',
        updated_at: 'ts-a',
      },
      present: ['platform/blog/swept.webp'],
      restoreRows: [],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      expectedUpdatedAt: 'ts-a',
      existingPost: { content: '<p>Old</p>' },
      finalUpdateData: { content: '<p>New</p>' },
      mediaRow: SWEPT_MEDIA_ROW,
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: false });
    expect(state.restored).toHaveLength(3);
  });

  it('retries the restore when it resolves with an error', async () => {
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: { content: '<p>New</p>', updated_at: 'ts-a' },
      present: ['platform/blog/swept.webp'],
      restoreErrors: [{ message: 'locked' }, null],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      expectedUpdatedAt: 'ts-a',
      existingPost: { content: '<p>Old</p>' },
      finalUpdateData: { content: '<p>New</p>' },
      mediaRow: SWEPT_MEDIA_ROW,
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    expect(state.restored).toEqual([
      { content: '<p>Old</p>' },
      { content: '<p>Old</p>' },
    ]);
  });

  it('restores when media presence is unverifiable', async () => {
    const { client, state } = fakeClient({
      current: { content: '<p>New</p>', updated_at: 'ts-a' },
      present: null,
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      expectedUpdatedAt: 'ts-a',
      existingPost: { content: '<p>Old</p>' },
      finalUpdateData: { content: '<p>New</p>' },
      mediaRow: {
        content:
          '<img src="https://cdn.example.com/media/platform/blog/shared.webp">',
      },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    expect(state.restored).toEqual([{ content: '<p>Old</p>' }]);
  });
});

function patchSupabase(present: string[], preRead: Record<string, unknown>) {
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
          title: 'Old title',
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          content:
            '<p>New</p><img src="https://cdn.example.com/media/platform/blog/swept.webp">',
          id: 'post-1',
          slug: 'new-slug',
          updated_at: 'ts-a',
        },
        error: null,
      })
      .mockResolvedValueOnce({ data: preRead, error: null }),
    update: vi.fn((value: Record<string, unknown>) => {
      updates.push(value);
      return query;
    }),
  };
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.select.mockImplementation((columns: string) =>
    columns === 'id'
      ? Promise.resolve({ data: [{ id: 'post-1' }], error: null })
      : query
  );
  return { from: vi.fn(() => query), rpc: query.rpc, updates };
}

describe('PATCH media verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 and restores the pre-image when media was swept mid-save', async () => {
    // Title-only patch: the guard pre-read matches every written
    // field, so the restore proceeds.
    const supabase = patchSupabase([], {
      is_platform_post: true,
      merchant_id: null,
      title: 'Updated',
      updated_at: 'ts-a',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        body: JSON.stringify({ title: 'Updated' }),
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
      supabase.updates.some((update) => update.title === 'Old title')
    ).toBe(true);
    expect(mocks.revalidatePlatformBlog).not.toHaveBeenCalled();
  });

  it('returns 500 without clobbering an intervening update', async () => {
    // Tab B saved after tab A: the guard pre-read mismatches, so no
    // restore runs and B's re-verified content stands.
    const supabase = patchSupabase([], {
      is_platform_post: true,
      merchant_id: null,
      title: 'Bee',
      updated_at: 'ts-b',
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await updatePlatformBlogPost(
      new NextRequest('http://localhost/api/admin/blog/posts/post-1', {
        body: JSON.stringify({ title: 'Updated' }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH',
      }),
      { params: Promise.resolve({ id: 'post-1' }) }
    );

    expect(response.status).toBe(500);
    expect(supabase.updates).toHaveLength(1);
    expect(mocks.revalidatePlatformBlog).not.toHaveBeenCalled();
  });
});
