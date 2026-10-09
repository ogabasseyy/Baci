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
  return { ...hook, refreshUpload };
}

describe('useBlogFeaturedImageUpload revive', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);
  it('refreshes a revived upload immediately instead of waiting for a beat', async () => {
    // The staged tombstone may already be due when a later import
    // reuses the upload; without an immediate refresh, the sweep
    // claims the newly reused image before the next heartbeat.
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { refreshUpload, result } = setup(async () => ({ url: reused }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
      });
    });
    expect(refreshUpload).not.toHaveBeenCalled();
    await act(async () => {
      result.current.cleanupSettledSessionUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
        featured_image_url: reused,
      });
    });
    // No timers advance here: the call proves the promotion itself
    // refreshed, not a later heartbeat.
    expect(refreshUpload).toHaveBeenCalledWith(['platform/blog/cover.webp']);
  });
});
