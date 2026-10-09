import { describe, expect, it, vi } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { refreshBlogMediaTombstones } from './blog-media-tombstone-refresh';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(
  refreshedPaths: string[] = ['platform/blog/draft.webp'],
  updateError: { message: string } | null = null
) {
  const select = vi.fn(() =>
    Promise.resolve({
      data: refreshedPaths.map((path) => ({ path })),
      error: updateError,
    })
  );
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn((_payload: { created_at: string }) => ({
    in: vi.fn(() => ({ eq })),
  }));
  const client = {
    from: vi.fn(() => ({ update })),
  } as unknown as ServerSupabaseClient;
  return { client, eq, select, update };
}

describe('refreshBlogMediaTombstones', () => {
  it('bumps unclaimed rows past the sweep cutoff', async () => {
    const { client, update } = fakeClient();
    const before = Date.now();

    const refreshed = await refreshBlogMediaTombstones(client, [
      'platform/blog/draft.webp',
    ]);

    expect(refreshed).toBe(true);
    const payload = update.mock.calls[0]?.[0] as { created_at: string };
    expect(Date.parse(payload.created_at)).toBeGreaterThanOrEqual(before);
  });

  it('never refreshes claimed rows', async () => {
    const { client, eq } = fakeClient();

    await refreshBlogMediaTombstones(client, ['platform/blog/draft.webp']);

    expect(eq).toHaveBeenCalledWith('claimed', false);
  });

  it('reports failure without throwing', async () => {
    const { client } = fakeClient([], { message: 'down' });

    await expect(
      refreshBlogMediaTombstones(client, ['platform/blog/draft.webp'])
    ).resolves.toBe(false);
  });

  it('fails when RLS silently drops a row', async () => {
    // An UPDATE policy gap returns success with fewer rows: every
    // requested path must come back or the lease did not move.
    const { client } = fakeClient(['platform/blog/draft.webp']);

    await expect(
      refreshBlogMediaTombstones(client, [
        'platform/blog/draft.webp',
        'platform/blog/other.webp',
      ])
    ).resolves.toBe(false);
  });

  it('skips empty path lists', async () => {
    const { client, update } = fakeClient();

    await expect(refreshBlogMediaTombstones(client, [])).resolves.toBe(true);
    expect(update).not.toHaveBeenCalled();
  });
});
