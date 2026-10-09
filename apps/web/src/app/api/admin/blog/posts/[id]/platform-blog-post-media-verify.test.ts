import { describe, expect, it, vi } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { verifyPatchedBlogPostMediaOrRestore } from './platform-blog-post-media-verify';

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
    // Only media keys present in the pre-image restore: the slug
    // this save wrote is unrelated to the media failure and stands.
    expect(state.restored).toEqual([{ content: '<p>Old</p>' }]);
    expect(state.eqCalls).toContainEqual(['content', '<p>New</p>']);
    expect(state.eqCalls).not.toContainEqual(['slug', 'new-slug']);
  });

  it('skips verification when the update wrote no media', async () => {
    // A title-only patch cannot break media it did not write: even
    // with every ambient object missing, the save succeeds and the
    // media writer owns the failure. Presence is never probed.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      present: [],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: { content: '<p>Old</p>', title: 'Old title' },
      finalUpdateData: { title: 'Updated' },
      mediaRow: SWEPT_MEDIA_ROW,
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: true });
    expect(state.restored).toEqual([]);
    expect(state.eqCalls).toEqual([]);
  });

  it('restores media despite an intervening non-media update', async () => {
    // Tab A wrote media; tab B then changed only the slug, moving
    // updated_at. The media keys still match tab A's write, so the
    // restore proceeds: gating on the timestamp would skip it and
    // leave both tabs 500 with the row referencing swept bytes.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: {
        content: '<p>New</p>',
        is_platform_post: true,
        merchant_id: null,
        slug: 'bee-slug',
        updated_at: 'ts-b',
      },
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
      mediaRow: SWEPT_MEDIA_ROW,
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    expect(state.restored).toEqual([{ content: '<p>Old</p>' }]);
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
