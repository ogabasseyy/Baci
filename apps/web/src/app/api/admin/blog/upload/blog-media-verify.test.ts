import { describe, expect, it } from 'vitest';
import type { createClient } from '@/lib/supabase/server';
import { verifyBlogMediaObjectsPresent } from './blog-media-verify';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

function fakeClient(
  present: string[],
  claimed: string[],
  error: { message: string } | null
) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: (_column: string, paths: string[]) => {
            if (error) return Promise.resolve({ data: null, error });
            return Promise.resolve({
              data: paths
                .filter((path) => claimed.includes(path))
                .map((path) => ({ path })),
              error: null,
            });
          },
        }),
      }),
    }),
    rpc: (name: string, args: { p_paths: string[] }) => {
      if (name !== 'blog_media_objects_present_v1') {
        throw new Error(`unexpected rpc ${name}`);
      }
      if (error) return Promise.resolve({ data: null, error });
      return Promise.resolve({
        data: args.p_paths
          .filter((path) => present.includes(path))
          .map((path) => ({ path })),
        error: null,
      });
    },
  } as unknown as ServerSupabaseClient;
}

describe('verifyBlogMediaObjectsPresent', () => {
  it('reports no missing paths when every object exists unclaimed', async () => {
    const paths = ['platform/blog/a.webp', 'platform/blog/b.webp'];

    await expect(
      verifyBlogMediaObjectsPresent(fakeClient(paths, [], null), paths)
    ).resolves.toEqual({ missing: [] });
  });

  it('reports paths the sweep already claimed', async () => {
    // The claimed flag is set while the object metadata is still
    // present, so the flag probe must catch the in-flight claim even
    // though the presence probe still passes.
    await expect(
      verifyBlogMediaObjectsPresent(
        fakeClient(
          ['platform/blog/a.webp', 'platform/blog/swept.webp'],
          ['platform/blog/swept.webp'],
          null
        ),
        ['platform/blog/a.webp', 'platform/blog/swept.webp']
      )
    ).resolves.toEqual({ missing: ['platform/blog/swept.webp'] });
  });

  it('reports paths whose metadata is gone', async () => {
    await expect(
      verifyBlogMediaObjectsPresent(
        fakeClient(['platform/blog/a.webp'], [], null),
        ['platform/blog/a.webp', 'platform/blog/swept.webp']
      )
    ).resolves.toEqual({ missing: ['platform/blog/swept.webp'] });
  });

  it('returns null when presence is unverifiable', async () => {
    await expect(
      verifyBlogMediaObjectsPresent(fakeClient([], [], { message: 'down' }), [
        'platform/blog/a.webp',
      ])
    ).resolves.toBeNull();
  });

  it('skips the probes when the payload references no media', async () => {
    const client = {
      from: () => {
        throw new Error('must not query');
      },
      rpc: () => {
        throw new Error('must not probe');
      },
    } as unknown as ServerSupabaseClient;

    await expect(verifyBlogMediaObjectsPresent(client, [])).resolves.toEqual({
      missing: [],
    });
  });
});
