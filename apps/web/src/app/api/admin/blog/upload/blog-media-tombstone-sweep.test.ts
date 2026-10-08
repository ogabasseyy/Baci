import { describe, expect, it } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { BLOG_MEDIA_TOMBSTONE_TABLE } from './blog-media-tombstone-constants';
import { sweepDueBlogMediaTombstones } from './blog-media-tombstone-sweep';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ClaimRow = { tombstone_claimed: boolean; tombstone_path: string };

function fakeStore() {
  const state = {
    claim: [] as ClaimRow[],
    now: new Date('2026-10-08T12:00:00.000Z'),
    removeError: null as { message: string } | null,
    removed: [] as string[],
    restaged: [] as string[],
    rpcError: null as { message: string } | null,
  };
  const client = {
    from: (table: string) => {
      if (table !== BLOG_MEDIA_TOMBSTONE_TABLE) {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        upsert: (rows: { path: string }[]) => {
          state.restaged.push(...rows.map((row) => row.path));
          return Promise.resolve({ error: null });
        },
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
    expect(state.restaged).toEqual([]);
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

  it('re-stages claimed paths when byte removal fails', async () => {
    // Metadata is already dropped (the object is unservable), so the
    // claim must be re-staged for a later sweep to retry the bytes
    // instead of leaking them.
    const { client, state } = fakeStore();
    state.claim = [
      { tombstone_claimed: true, tombstone_path: 'platform/blog/old.webp' },
    ];
    state.removeError = { message: 'down' };

    expect(await sweepDueBlogMediaTombstones(client, state.now)).toBeNull();
    expect(state.restaged).toEqual(['platform/blog/old.webp']);
  });
});
