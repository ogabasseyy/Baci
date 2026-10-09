import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { verifyPatchedBlogPostMediaOrRestore } from './platform-blog-post-media-verify';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(args: {
  claimed?: string[];
  current?: Record<string, unknown> | null;
  present: string[] | null;
}) {
  const claimed = args.claimed ?? [];
  const state = {
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
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.in.mockImplementation((_column: string, paths: string[]) =>
    Promise.resolve({
      data: paths
        .filter((path) => claimed.includes(path))
        .map((path) => ({ path })),
      error: null,
    })
  );
  query.select.mockImplementation((columns: string) =>
    columns === 'id'
      ? Promise.resolve({ data: [{ id: 'post-1' }], error: null })
      : query
  );
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

const SWEPT_URL = 'https://cdn.example.com/media/platform/blog/swept.webp';

describe('verifyPatchedBlogPostMediaOrRestore dependents', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('restores word stats together with rejected content', async () => {
    // The handler derives word_count and reading_time_minutes from
    // the new content; restoring content without them persists the
    // old article with the rejected draft's statistics.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: {
        content: `<p>New</p><img src="${SWEPT_URL}">`,
        reading_time_minutes: 9,
        word_count: 900,
      },
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: {
        content: '<p>Old</p>',
        reading_time_minutes: 1,
        word_count: 100,
      },
      finalUpdateData: {
        content: `<p>New</p><img src="${SWEPT_URL}">`,
        reading_time_minutes: 9,
        word_count: 900,
      },
      mediaRow: { content: `<p>New</p><img src="${SWEPT_URL}">` },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    expect(state.restored).toEqual([
      { content: '<p>Old</p>', reading_time_minutes: 1, word_count: 100 },
    ]);
  });

  it('restores alt and dimensions together with the image URL', async () => {
    // A featured-image swap writes alt text and dimensions for the
    // new bytes; restoring the URL alone leaves them describing a
    // different image than the row serves.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: {
        featured_image_alt: 'New alt',
        featured_image_height: 600,
        featured_image_url: SWEPT_URL,
        featured_image_width: 800,
      },
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: {
        featured_image_alt: 'Old alt',
        featured_image_height: 60,
        featured_image_url: 'https://cdn.example.com/media/old.webp',
        featured_image_width: 80,
      },
      finalUpdateData: {
        featured_image_alt: 'New alt',
        featured_image_height: 600,
        featured_image_url: SWEPT_URL,
        featured_image_width: 800,
      },
      mediaRow: { featured_image_url: SWEPT_URL },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    expect(state.restored).toEqual([
      {
        featured_image_alt: 'Old alt',
        featured_image_height: 60,
        featured_image_url: 'https://cdn.example.com/media/old.webp',
        featured_image_width: 80,
      },
    ]);
  });

  it('skips the restore when another tab rewrote a dependent', async () => {
    // Tab B corrected the alt text after tab A's image swap: the
    // dependent guard mismatches, so no restore runs and B's edit
    // stands instead of being clobbered by A's pre-image.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: {
        featured_image_alt: 'Bee alt',
        featured_image_url: SWEPT_URL,
      },
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: {
        featured_image_alt: 'Old alt',
        featured_image_url: 'https://cdn.example.com/media/old.webp',
      },
      finalUpdateData: {
        featured_image_alt: 'New alt',
        featured_image_url: SWEPT_URL,
      },
      mediaRow: { featured_image_url: SWEPT_URL },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: false });
    expect(state.restored).toEqual([]);
  });

  it('leaves dependents this save never wrote untouched', async () => {
    // A URL-only write restores the URL alone: the untouched alt
    // keeps its current value rather than reverting to a snapshot
    // that predates another tab's independent edit.
    const { client, state } = fakeClient({
      claimed: ['platform/blog/swept.webp'],
      current: { featured_image_url: SWEPT_URL },
      present: ['platform/blog/swept.webp'],
    });

    const result = await verifyPatchedBlogPostMediaOrRestore(client, {
      existingPost: {
        featured_image_alt: 'Old alt',
        featured_image_url: 'https://cdn.example.com/media/old.webp',
      },
      finalUpdateData: { featured_image_url: SWEPT_URL },
      mediaRow: { featured_image_url: SWEPT_URL },
      postId: 'post-1',
    });

    expect(result).toEqual({ ok: false, restored: true });
    expect(state.restored).toEqual([
      { featured_image_url: 'https://cdn.example.com/media/old.webp' },
    ]);
  });
});
