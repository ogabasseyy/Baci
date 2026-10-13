import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogInlineImageUpload } from './use-blog-inline-image-upload';

const file = new File(['image'], 'inline.png');

function setup(upload: (file: File) => Promise<{ url: string }>) {
  const deleteUpload = vi.fn(async () => {});
  const refreshUpload = vi.fn(async () => {});
  const savedFormRef = {
    current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
  };
  const hook = renderHook(() =>
    useBlogInlineImageUpload({
      deleteUpload,
      refreshUpload,
      savedFormRef,
      upload,
    })
  );
  return { ...hook, refreshUpload };
}

describe('useBlogInlineImageUpload revive', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);
  it('refreshes a revived upload immediately instead of waiting for a beat', async () => {
    // The staged tombstone may already be due when a later import
    // reuses the upload; without an immediate refresh, the sweep
    // claims the newly reused image before the next heartbeat.
    const reused = 'https://cdn.example.com/media/platform/blog/inline.webp';
    const { refreshUpload, result } = setup(async () => ({ url: reused }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
      });
    });
    expect(refreshUpload).not.toHaveBeenCalled();
    await act(async () => {
      result.current.cleanupSettledInlineUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: `<p>Imported body</p><img src="${reused}">`,
      });
    });
    // No timers advance here: the call proves the promotion itself
    // refreshed, not a later heartbeat.
    expect(refreshUpload).toHaveBeenCalledWith(['platform/blog/inline.webp']);
  });
});
