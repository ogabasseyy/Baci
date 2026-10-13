import { describe, expect, it, vi } from 'vitest';
import { purgeVercelStorefrontPublicationCache } from './vercel-storefront-publication-cache';

describe('purgeVercelStorefrontPublicationCache', () => {
  it('foreground-deletes every unique merchant-scoped response tag', async () => {
    const deleteByTag = vi.fn().mockResolvedValue(undefined);

    await expect(
      purgeVercelStorefrontPublicationCache(
        ['ps:ogabassey', 'ph:ogabassey.com', 'ps:ogabassey'],
        { deleteByTag, isVercel: true }
      )
    ).resolves.toEqual({ ok: true, reason: 'deleted' });
    expect(deleteByTag).toHaveBeenCalledWith(
      ['ps:ogabassey', 'ph:ogabassey.com'],
      { revalidationDeadlineSeconds: 0 }
    );
  });

  it('does not call the Vercel API outside Vercel', async () => {
    const deleteByTag = vi.fn();

    await expect(
      purgeVercelStorefrontPublicationCache(['ps:ogabassey'], {
        deleteByTag,
        isVercel: false,
      })
    ).resolves.toEqual({ ok: true, reason: 'not_running_on_vercel' });
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it('treats an empty tag set as no work', async () => {
    const deleteByTag = vi.fn();

    await expect(
      purgeVercelStorefrontPublicationCache([], {
        deleteByTag,
        isVercel: true,
      })
    ).resolves.toEqual({ ok: true, reason: 'not_required' });
    expect(deleteByTag).not.toHaveBeenCalled();
  });

  it('reports a foreground deletion failure', async () => {
    const deleteByTag = vi.fn().mockRejectedValue(new Error('Vercel down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      purgeVercelStorefrontPublicationCache(['ps:ogabassey'], {
        deleteByTag,
        isVercel: true,
      })
    ).resolves.toEqual({ ok: false, reason: 'request_failed' });
  });

  it('supports stale-while-revalidate invalidation for ordinary updates', async () => {
    const invalidateByTag = vi.fn().mockResolvedValue(undefined);

    await expect(
      purgeVercelStorefrontPublicationCache(['product:123'], {
        invalidateByTag,
        isVercel: true,
        mode: 'invalidate',
      })
    ).resolves.toEqual({ ok: true, reason: 'invalidated' });
    expect(invalidateByTag).toHaveBeenCalledWith(['product:123']);
  });

  it('reports an SWR invalidation failure', async () => {
    const invalidateByTag = vi.fn().mockRejectedValue(new Error('Vercel down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(
      purgeVercelStorefrontPublicationCache(['product:123'], {
        invalidateByTag,
        isVercel: true,
        mode: 'invalidate',
      })
    ).resolves.toEqual({ ok: false, reason: 'request_failed' });
  });

  it('chunks large identity sets within the 16-tag bulk purge bound', async () => {
    const deleteByTag = vi.fn().mockResolvedValue(undefined);
    const tags = Array.from({ length: 17 }, (_, index) => `ps:store-${index}`);

    await expect(
      purgeVercelStorefrontPublicationCache(tags, {
        deleteByTag,
        isVercel: true,
      })
    ).resolves.toEqual({ ok: true, reason: 'deleted' });
    expect(deleteByTag).toHaveBeenNthCalledWith(1, tags.slice(0, 16), {
      revalidationDeadlineSeconds: 0,
    });
    expect(deleteByTag).toHaveBeenNthCalledWith(2, tags.slice(16), {
      revalidationDeadlineSeconds: 0,
    });
  });
});
