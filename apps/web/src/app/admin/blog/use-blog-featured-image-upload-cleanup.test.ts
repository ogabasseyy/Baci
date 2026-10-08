import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogFeaturedImageUpload } from './use-blog-featured-image-upload';

const file = new File(['image'], 'cover.png');

function setup(
  upload: (file: File) => Promise<{
    url: string;
    width?: number | null;
    height?: number | null;
    variants?: Record<string, string>;
  }>
) {
  const deleteUpload = vi.fn(
    async (_request: {
      path: string;
      variantPaths: string[];
      signal: AbortSignal;
    }): Promise<void> => {}
  );
  const toast = vi.fn();
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef: { current: null },
      deleteUpload,
      setForm,
      toast,
      upload,
    });
    return { ...uploader, form };
  });
  return { ...hook, deleteUpload, toast };
}

const discardDraft = {
  ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
  content: '<p>Imported body</p>',
};

describe('useBlogFeaturedImageUpload cleanup', () => {
  it('batches cleanup above the shared delete budget into one call', async () => {
    let count = 0;
    const { deleteUpload, result } = setup(async () => {
      count += 1;
      return {
        url: `https://cdn.example.com/media/platform/blog/session-${count}.webp`,
        variants: {
          landscape_16x9: `https://cdn.example.com/media/platform/blog/session-${count}/landscape_16x9.webp`,
        },
      };
    });
    for (let index = 0; index < 31; index += 1) {
      await act(async () => {
        await result.current.uploadFeatured(file);
      });
    }
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    // The platform_blog_media_delete bucket allows 30 requests per
    // minute shared with inline cleanup: 31 uploads (62 objects)
    // must collapse into a single DELETE instead of one call each.
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    const [, ...expectedRest] = Array.from({ length: 31 }, (_, index) => [
      `platform/blog/session-${index + 1}.webp`,
      `platform/blog/session-${index + 1}/landscape_16x9.webp`,
    ]).flat();
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/session-1.webp',
      variantPaths: expectedRest,
      signal: expect.any(AbortSignal),
    });
  });

  it('aborts an in-flight delete when the next import reuses the upload', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, result } = setup(async () => ({ url: reused }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    const pending = Promise.withResolvers<void>();
    deleteUpload.mockReturnValueOnce(pending.promise);
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    const signal = deleteUpload.mock.calls[0]?.[0].signal as
      | AbortSignal
      | undefined;
    expect(signal).toBeInstanceOf(AbortSignal);
    // Second import reuses the upload while its delete is in flight:
    // the batch is aborted before it can remove active-draft media.
    await act(async () => {
      result.current.cleanupSettledSessionUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
        featured_image_url: reused,
      });
    });
    expect(signal?.aborted).toBe(true);
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.reject(
        Object.assign(new Error('Aborted'), { name: 'AbortError' })
      );
    });
    // The aborted upload stays tracked: a later import that drops it
    // deletes it then.
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    expect(deleteUpload).toHaveBeenCalledTimes(2);
    expect(deleteUpload).toHaveBeenLastCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves failed cleanup entries for the next import', async () => {
    const { deleteUpload, result } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/settled.webp',
    }));
    deleteUpload.mockRejectedValueOnce(new Error('Delete failed'));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    expect(deleteUpload).toHaveBeenCalledTimes(2);
    expect(deleteUpload).toHaveBeenLastCalledWith({
      path: 'platform/blog/settled.webp',
      variantPaths: [],
      signal: expect.any(AbortSignal),
    });
  });

  it('trims retained uploads to their kept paths', async () => {
    const { deleteUpload, result } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/cover.webp',
      variants: {
        landscape_16x9:
          'https://cdn.example.com/media/platform/blog/cover/landscape_16x9.webp',
      },
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    // First import keeps the cover but not its variant: only the
    // variant is deleted, and the trimmed result stays tracked.
    await act(async () => {
      result.current.cleanupSettledSessionUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
        featured_image_url:
          'https://cdn.example.com/media/platform/blog/cover.webp',
      });
    });
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover/landscape_16x9.webp',
      variantPaths: [],
      signal: expect.any(AbortSignal),
    });
    // Second import discards the cover too: the already-deleted
    // variant must not be retried.
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    expect(deleteUpload).toHaveBeenLastCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
      signal: expect.any(AbortSignal),
    });
  });
});
