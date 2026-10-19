import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BLOG_MEDIA_TOMBSTONE_GRACE_MS } from '@/app/api/admin/blog/upload/blog-media-tombstone-constants';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogFeaturedImageUpload } from './use-blog-featured-image-upload';

const file = new File(['image'], 'cover.png');
const draftUrl = 'https://cdn.example.com/media/platform/blog/draft.webp';

function setup() {
  const refreshUpload = vi.fn(async () => {});
  const savedFormRef = {
    current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
  };
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef: { current: null },
      deleteUpload: vi.fn(async () => {}),
      heartbeatIntervalMs: 1000,
      refreshUpload,
      savedFormRef,
      setForm,
      toast: vi.fn(),
      upload: async () => ({ url: draftUrl }),
    });
    return { ...uploader, form };
  });
  return { ...hook, refreshUpload, savedFormRef };
}

describe('useBlogFeaturedImageUpload heartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('keeps unsaved uploads leased past the grace window', async () => {
    // An editor open for hours is not abandoned: the heartbeat must
    // still refresh the staged cover when the original one-hour
    // grace window expires, or the cron deletes it mid-draft.
    const { refreshUpload, result, unmount } = setup();
    await act(async () => {
      await result.current.uploadFeatured(file);
    });

    await act(async () => {
      vi.advanceTimersByTime(BLOG_MEDIA_TOMBSTONE_GRACE_MS + 1000);
    });

    expect(refreshUpload).toHaveBeenCalledWith(['platform/blog/draft.webp']);
    expect(refreshUpload.mock.calls.length).toBeGreaterThan(3600);
    await act(async () => {
      unmount();
    });
  });

  it('stops refreshing uploads once the draft saves', async () => {
    const { refreshUpload, result, savedFormRef, unmount } = setup();
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(refreshUpload).toHaveBeenCalledTimes(1);

    // The server confirmed a payload referencing the cover: the save
    // cleared its tombstone, so the lease needs no more beats.
    savedFormRef.current = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      featured_image_url: draftUrl,
    };
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(refreshUpload).toHaveBeenCalledTimes(1);
    await act(async () => {
      unmount();
    });
  });
});
