import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  const deleteUpload = vi.fn(async () => {});
  const refreshUpload = vi.fn(async () => {});
  const toast = vi.fn();
  const savedFormRef = {
    current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
  };
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef: { current: null },
      deleteUpload,
      refreshUpload,
      savedFormRef,
      setForm,
      toast,
      upload,
    });
    return { ...uploader, form };
  });
  return { ...hook, deleteUpload, savedFormRef, toast };
}

const discardDraft = {
  ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
  content: '<p>Imported body</p>',
};

describe('useBlogFeaturedImageUpload batching', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);
  it('batches cleanup above the shared delete budget into one call', async () => {
    let count = 0;
    const { deleteUpload, result, unmount } = setup(async () => {
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
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => {
      unmount();
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
    });
  });

  it('chunks the unmount flush at the Storage object limit', async () => {
    // Supabase remove() caps at 1,000 objects per call: an oversized
    // single flush would fail and leak every staged object silently.
    const variants = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [
        `landscape_${index}`,
        `https://cdn.example.com/media/platform/blog/variant-${index}.webp`,
      ])
    );
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/cover.webp',
      variants,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(2);
    const requests = (
      deleteUpload.mock.calls as unknown as [
        { path: string; variantPaths: string[] },
      ][]
    ).map(([request]) => request);
    expect(
      requests.reduce(
        (total, request) => total + 1 + request.variantPaths.length,
        0
      )
    ).toBe(1002);
    expect(requests[0]?.variantPaths).toHaveLength(999);
    expect(requests[1]?.variantPaths).toHaveLength(1);
  });
});
