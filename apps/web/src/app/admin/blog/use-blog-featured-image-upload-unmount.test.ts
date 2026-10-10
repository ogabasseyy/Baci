import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, StrictMode, useState } from 'react';
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
  const refs = () => ({
    savedFormRef: {
      current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
    },
  });
  const initialRefs = refs();
  const hook = renderHook(
    ({ hookRefs }) => {
      const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
      const uploader = useBlogFeaturedImageUpload({
        coverStashRef: { current: null },
        deleteUpload,
        refreshUpload,
        setForm,
        toast,
        upload,
        ...hookRefs,
      });
      return { ...uploader, form };
    },
    {
      initialProps: { hookRefs: initialRefs },
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(StrictMode, null, children),
    }
  );
  const replayEffect = () => {
    act(() => {
      hook.rerender({ hookRefs: refs() });
    });
  };
  return { ...hook, deleteUpload, replayEffect, toast, ...initialRefs };
}

const abandonedUrl =
  'https://cdn.example.com/media/platform/blog/abandoned.webp';

describe('useBlogFeaturedImageUpload unmount', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);
  it('tracks uploads after a StrictMode effect replay', async () => {
    // StrictMode runs setup-cleanup-setup: the replayed setup must
    // restore the mounted flag or every upload late-deletes. The
    // harness does not replay StrictMode effects, so rerender with
    // fresh refs deterministically replays setup-cleanup-setup on the
    // same hook instance.
    const pending = Promise.withResolvers<{ url: string }>();
    const { deleteUpload, replayEffect, result, unmount } = setup(
      () => pending.promise
    );
    replayEffect();
    const url = 'https://cdn.example.com/media/platform/blog/strict.webp';
    act(() => {
      void result.current.uploadFeatured(file);
    });
    await act(async () => {
      pending.resolve({ url });
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    expect(result.current.form.featured_image_url).toBe(url);
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => {
      expect(deleteUpload).toHaveBeenCalledTimes(1);
    });
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/strict.webp',
      variantPaths: [],
    });
  });

  it('deletes live-only uploads when abandoning an unsaved form', async () => {
    // Upload-then-Back without saving: the live form references media
    // that exists nowhere else, so teardown must delete it. Only a
    // successfully submitted payload earns retention.
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: abandonedUrl,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    expect(result.current.form.featured_image_url).toBe(abandonedUrl);
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => {
      expect(deleteUpload).toHaveBeenCalledTimes(1);
    });
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/abandoned.webp',
      variantPaths: [],
    });
  });

  it('keeps uploads the saved payload references on teardown', async () => {
    const { deleteUpload, result, savedFormRef, unmount } = setup(async () => ({
      url: abandonedUrl,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    savedFormRef.current = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      featured_image_url: abandonedUrl,
    };
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});
