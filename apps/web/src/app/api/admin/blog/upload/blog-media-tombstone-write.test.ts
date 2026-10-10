import { describe, expect, it, vi } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { tombstoneBlogMediaPaths } from './blog-media-tombstone-write';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(
  result: { error: { message: string } | null } | { throws: true }
) {
  const upsert = vi.fn(() => {
    if ('throws' in result) return Promise.reject(new Error('down'));
    return Promise.resolve(result);
  });
  return {
    client: {
      from: () => ({ upsert }),
    } as unknown as ServerSupabaseClient,
    upsert,
  };
}

describe('tombstoneBlogMediaPaths', () => {
  it('stages paths without refreshing existing tombstones', async () => {
    const { client, upsert } = fakeClient({ error: null });
    expect(
      await tombstoneBlogMediaPaths(client, ['platform/blog/orphan.webp'])
    ).toBe(true);
    expect(upsert).toHaveBeenCalledWith(
      [{ path: 'platform/blog/orphan.webp' }],
      {
        ignoreDuplicates: true,
        onConflict: 'path',
      }
    );
  });

  it('skips the query when no paths are staged', async () => {
    const { client, upsert } = fakeClient({ error: null });
    expect(await tombstoneBlogMediaPaths(client, [])).toBe(true);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('returns false when staging fails', async () => {
    const failed = fakeClient({ error: { message: 'down' } });
    expect(
      await tombstoneBlogMediaPaths(failed.client, [
        'platform/blog/orphan.webp',
      ])
    ).toBe(false);
    const thrown = fakeClient({ throws: true });
    expect(
      await tombstoneBlogMediaPaths(thrown.client, [
        'platform/blog/orphan.webp',
      ])
    ).toBe(false);
  });
});
