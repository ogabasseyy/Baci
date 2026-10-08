import { describe, expect, it } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import type { BlogPostMediaRow } from './blog-media-reference-scan';
import { clearBlogMediaTombstonesForRow } from './blog-media-tombstone-clear';
import {
  BLOG_MEDIA_TOMBSTONE_GRACE_MS,
  BLOG_MEDIA_TOMBSTONE_TABLE,
} from './blog-media-tombstone-constants';
import { sweepDueBlogMediaTombstones } from './blog-media-tombstone-sweep';
import { tombstoneBlogMediaPaths } from './blog-media-tombstone-write';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type TombstoneRow = { created_at: string; path: string };

function fakeStore() {
  const state = {
    now: new Date('2026-10-08T12:00:00.000Z'),
    onRecheck: null as null | (() => void),
    posts: [] as BlogPostMediaRow[],
    removeError: null as { message: string } | null,
    removed: [] as string[],
    scanError: null as { message: string } | null,
    tombstones: [] as TombstoneRow[],
  };
  const serveDueTombstones = (cutoff: string, count: number) => {
    if (state.scanError) {
      return Promise.resolve({ data: null, error: state.scanError });
    }
    return Promise.resolve({
      data: state.tombstones
        .filter((row) => row.created_at < cutoff)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, count)
        .map((row) => ({ path: row.path })),
      error: null,
    });
  };
  const tombstoneTable = {
    delete: () => ({
      in: (_column: string, paths: string[]) => {
        state.tombstones = state.tombstones.filter(
          (row) => !paths.includes(row.path)
        );
        return Promise.resolve({ error: null });
      },
    }),
    select: () => ({
      in: (_column: string, paths: string[]) => {
        // A test hook models a save committing between the reference
        // scan and this recheck read.
        state.onRecheck?.();
        state.onRecheck = null;
        return Promise.resolve({
          data: state.tombstones
            .filter((row) => paths.includes(row.path))
            .map((row) => ({ path: row.path })),
          error: null,
        });
      },
      lt: (_column: string, cutoff: string) => ({
        limit: (count: number) => serveDueTombstones(cutoff, count),
        order: (_column: string) => ({
          limit: (count: number) => serveDueTombstones(cutoff, count),
        }),
      }),
    }),
    upsert: (
      rows: { path: string }[],
      options: { ignoreDuplicates?: boolean }
    ) => {
      for (const row of rows) {
        if (
          options.ignoreDuplicates &&
          state.tombstones.some((kept) => kept.path === row.path)
        ) {
          continue;
        }
        state.tombstones.push({
          created_at: state.now.toISOString(),
          path: row.path,
        });
      }
      return Promise.resolve({ error: null });
    },
  };
  const client = {
    from: (table: string) => {
      if (table === BLOG_MEDIA_TOMBSTONE_TABLE) return tombstoneTable;
      return {
        select: () => ({
          eq: () => ({
            is: () => ({
              order: () => ({
                range: (from: number, to: number) => {
                  if (state.scanError) {
                    return Promise.resolve({
                      data: null,
                      error: state.scanError,
                    });
                  }
                  return Promise.resolve({
                    data: state.posts.slice(from, to + 1),
                    error: null,
                  });
                },
              }),
            }),
          }),
        }),
      };
    },
    storage: {
      from: () => ({
        remove: (paths: string[]) => {
          if (state.removeError) {
            return Promise.resolve({ error: state.removeError });
          }
          state.removed.push(...paths);
          return Promise.resolve({ error: null });
        },
      }),
    },
  } as unknown as ServerSupabaseClient;
  return { client, state };
}

describe('sweepDueBlogMediaTombstones', () => {
  const GRACE = BLOG_MEDIA_TOMBSTONE_GRACE_MS;

  it('removes due unreferenced paths and clears resurrected rows', async () => {
    const { client, state } = fakeStore();
    state.tombstones = [
      {
        created_at: '2026-10-08T10:00:00.000Z',
        path: 'platform/blog/old.webp',
      },
      {
        created_at: '2026-10-08T10:30:00.000Z',
        path: 'platform/blog/kept.webp',
      },
      {
        created_at: '2026-10-08T11:30:00.000Z',
        path: 'platform/blog/fresh.webp',
      },
    ];
    state.posts = [
      {
        content:
          '<img src="https://cdn.example.com/media/platform/blog/kept.webp">',
      },
    ];

    const result = await sweepDueBlogMediaTombstones(client, state.now);

    expect(result).toEqual({
      resurrected: ['platform/blog/kept.webp'],
      swept: ['platform/blog/old.webp'],
    });
    expect(state.removed).toEqual(['platform/blog/old.webp']);
    expect(state.tombstones.map((row) => row.path)).toEqual([
      'platform/blog/fresh.webp',
    ]);
  });

  it('returns null when the sweep cannot verify safety', async () => {
    const failed = fakeStore();
    failed.state.tombstones = [
      {
        created_at: '2026-10-08T10:00:00.000Z',
        path: 'platform/blog/old.webp',
      },
    ];
    failed.state.scanError = { message: 'down' };
    expect(
      await sweepDueBlogMediaTombstones(failed.client, failed.state.now)
    ).toBeNull();
    expect(failed.state.removed).toEqual([]);

    const removal = fakeStore();
    removal.state.tombstones = [
      {
        created_at: '2026-10-08T10:00:00.000Z',
        path: 'platform/blog/old.webp',
      },
    ];
    removal.state.removeError = { message: 'down' };
    expect(
      await sweepDueBlogMediaTombstones(removal.client, removal.state.now)
    ).toBeNull();
    expect(removal.state.tombstones).toHaveLength(1);
  });

  it('lets a save between scan and removal invalidate the sweep', async () => {
    // The reference scan finishes before the save commits; the save
    // then commits and clears the tombstone. The pre-removal recheck
    // must see the cleared row and keep the media instead of
    // unconditionally removing what the first scan approved.
    const { client, state } = fakeStore();
    const shared = 'platform/blog/shared.webp';
    state.tombstones = [
      { created_at: '2026-10-08T10:00:00.000Z', path: shared },
    ];
    state.onRecheck = () => {
      state.posts = [
        {
          content: `<img src="https://cdn.example.com/media/${shared}">`,
        },
      ];
      state.tombstones = [];
    };

    const result = await sweepDueBlogMediaTombstones(client, state.now);

    expect(result).toEqual({ resurrected: [shared], swept: [] });
    expect(state.removed).toEqual([]);
  });

  it('closes the concurrent save/delete race deterministically', async () => {
    // Tab A tombstones its abandoned upload while tab B's save is in
    // flight; B commits and resurrects before the grace window ends,
    // so the later sweep must keep B's media while still removing a
    // genuinely abandoned path tombstoned in the same window.
    const { client, state } = fakeStore();
    const shared = 'platform/blog/shared.webp';
    const orphan = 'platform/blog/orphan.webp';

    expect(await tombstoneBlogMediaPaths(client, [shared, orphan])).toBe(true);
    state.posts = [
      {
        content: `<img src="https://cdn.example.com/media/${shared}">`,
      },
    ];
    await clearBlogMediaTombstonesForRow(client, state.posts[0]);
    state.now = new Date(state.now.getTime() + GRACE + 1000);

    const result = await sweepDueBlogMediaTombstones(client, state.now);

    expect(result).toEqual({ resurrected: [], swept: [orphan] });
    expect(state.removed).toEqual([orphan]);
    expect(state.tombstones).toEqual([]);
  });
});
