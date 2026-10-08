import { describe, expect, it } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';
import { sweepDueBlogMediaTombstones } from './blog-media-tombstone-sweep';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ClaimRow = { tombstone_claimed: boolean; tombstone_path: string };

function fakeStore() {
  const state = {
    claim: [] as ClaimRow[],
    cleanupError: null as { message: string } | null,
    cleaned: [] as string[],
    now: new Date('2026-10-08T12:00:00.000Z'),
    removeError: null as { message: string } | null,
    removed: [] as string[],
    rpcError: null as { message: string } | null,
  };
  const client = {
    from: (table: string) => {
      if (table !== BLOG_MEDIA_TOMBSTONE_TABLE) {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        delete: () => ({
          in: (_column: string, paths: string[]) => {
            state.cleaned.push(...paths);
            return Promise.resolve({ error: state.cleanupError });
          },
        }),
      };
    },
    rpc: (name: string) => {
      if (name !== 'claim_sweepable_blog_media_tombstones') {
        throw new Error(`unexpected rpc ${name}`);
      }
      if (state.rpcError) {
        return Promise.resolve({ data: null, error: state.rpcError });
      }
      return Promise.resolve({ data: state.claim, error: null });
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
  it('removes claimed bytes and reports resurrected rows', async () => {
    const { client, state } = fakeStore();
    state.claim = [
      { tombstone_claimed: true, tombstone_path: 'platform/blog/old.webp' },
      { tombstone_claimed: false, tombstone_path: 'platform/blog/kept.webp' },
    ];

    const result = await sweepDueBlogMediaTombstones(client, state.now);

    expect(result).toEqual({
      resurrected: ['platform/blog/kept.webp'],
      swept: ['platform/blog/old.webp'],
    });
    expect(state.removed).toEqual(['platform/blog/old.webp']);
    expect(state.cleaned).toEqual(['platform/blog/old.webp']);
  });

  it('returns empty verdicts when nothing is due', async () => {
    const { client, state } = fakeStore();

    const result = await sweepDueBlogMediaTombstones(client, state.now);

    expect(result).toEqual({ resurrected: [], swept: [] });
    expect(state.removed).toEqual([]);
  });

  it('returns null when the claim itself fails', async () => {
    const { client, state } = fakeStore();
    state.rpcError = { message: 'down' };

    expect(await sweepDueBlogMediaTombstones(client, state.now)).toBeNull();
    expect(state.removed).toEqual([]);
  });

  it('leaves claimed rows staged when byte removal fails', async () => {
    // Claimed rows persist until the Storage API removal succeeds, so
    // a failed sweep retries its bytes on the next run instead of
    // re-staging or leaking them.
    const { client, state } = fakeStore();
    state.claim = [
      { tombstone_claimed: true, tombstone_path: 'platform/blog/old.webp' },
    ];
    state.removeError = { message: 'down' };

    expect(await sweepDueBlogMediaTombstones(client, state.now)).toBeNull();
    expect(state.cleaned).toEqual([]);
  });

  it('still reports success when row cleanup fails', async () => {
    // Lingering claimed rows are rechecked next sweep while the API
    // removal is idempotent, so a cleanup failure must not fail the
    // sweep that already reclaimed the bytes.
    const { client, state } = fakeStore();
    state.claim = [
      { tombstone_claimed: true, tombstone_path: 'platform/blog/old.webp' },
    ];
    state.cleanupError = { message: 'down' };

    const result = await sweepDueBlogMediaTombstones(client, state.now);

    expect(result).toEqual({
      resurrected: [],
      swept: ['platform/blog/old.webp'],
    });
    expect(state.removed).toEqual(['platform/blog/old.webp']);
  });
});
