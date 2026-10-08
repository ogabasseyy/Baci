import { describe, expect, it, vi } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { clearBlogMediaTombstonesForRow } from './blog-media-tombstone-clear';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(
  result: { error: { message: string } | null } | { throws: true }
) {
  const terminal = () => {
    if ('throws' in result) return Promise.reject(new Error('down'));
    return Promise.resolve(result);
  };
  const remove = vi.fn();
  const onlyUnclaimed = vi.fn(terminal);
  return {
    client: {
      from: () => ({
        delete: () => ({
          in: (...args: unknown[]) => {
            remove(...args);
            return { eq: onlyUnclaimed };
          },
        }),
      }),
    } as unknown as ServerSupabaseClient,
    onlyUnclaimed,
    remove,
  };
}

const MEDIA_ROW = {
  author_image_url: 'https://cdn.example.com/media/platform/blog/author.webp',
  content:
    '<p>Body</p><img src="https://cdn.example.com/media/platform/blog/kept.webp">',
  excerpt: 'https://cdn.example.com/media/platform/blog/excerpt.webp',
  featured_image_url: 'https://cdn.example.com/media/platform/blog/cover.webp',
  featured_image_variants: {
    landscape_16x9:
      'https://cdn.example.com/media/platform/blog/kept/landscape_16x9.webp',
  },
};

describe('clearBlogMediaTombstonesForRow', () => {
  it('clears tombstones across media-carrying columns', async () => {
    const { client, remove } = fakeClient({ error: null });
    await clearBlogMediaTombstonesForRow(client, MEDIA_ROW);
    expect(remove).toHaveBeenCalledWith('path', [
      'platform/blog/kept.webp',
      'platform/blog/excerpt.webp',
      'platform/blog/cover.webp',
      'platform/blog/author.webp',
      'platform/blog/kept/landscape_16x9.webp',
    ]);
  });

  it('clears only unclaimed rows', async () => {
    // A claimed row means the sweep already decided to remove the
    // object; deleting the flag would blind verification instead of
    // stopping the removal.
    const { client, onlyUnclaimed } = fakeClient({ error: null });
    await clearBlogMediaTombstonesForRow(client, MEDIA_ROW);
    expect(onlyUnclaimed).toHaveBeenCalledWith('claimed', false);
  });

  it('skips the query when no managed paths are referenced', async () => {
    const { client, remove } = fakeClient({ error: null });
    await clearBlogMediaTombstonesForRow(client, { content: 'Plain body' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('never fails the committed save', async () => {
    const failed = fakeClient({ error: { message: 'down' } });
    await expect(
      clearBlogMediaTombstonesForRow(failed.client, MEDIA_ROW)
    ).resolves.toBeUndefined();
    const thrown = fakeClient({ throws: true });
    await expect(
      clearBlogMediaTombstonesForRow(thrown.client, MEDIA_ROW)
    ).resolves.toBeUndefined();
  });
});
