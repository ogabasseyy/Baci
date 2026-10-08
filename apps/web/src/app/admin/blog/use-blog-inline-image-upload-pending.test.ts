import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createElement, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogInlineImageUpload } from './use-blog-inline-image-upload';

const file = new File(['image'], 'inline.png');

function setup(upload: (file: File) => Promise<{ url: string }>) {
  const deleteUpload = vi.fn(async () => {});
  const savedFormRef = {
    current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
  };
  const hook = renderHook(() =>
    useBlogInlineImageUpload({ deleteUpload, savedFormRef, upload })
  );
  return { ...hook, deleteUpload, savedFormRef };
}

describe('useBlogInlineImageUpload pending', () => {
  it('reports pending while an upload is in flight', async () => {
    const pending = Promise.withResolvers<{ url: string }>();
    const { result } = setup(() => pending.promise);
    expect(result.current.inlineUploadsPending).toBe(false);

    let url: string | undefined;
    act(() => {
      void result.current
        .uploadInlineImage(file)
        .then((resolved) => (url = resolved));
    });
    expect(result.current.inlineUploadsPending).toBe(true);

    await act(async () =>
      pending.resolve({ url: 'https://cdn.example.com/inline.png' })
    );
    expect(result.current.inlineUploadsPending).toBe(false);
    expect(url).toBe('https://cdn.example.com/inline.png');
  });

  it('clears pending when an upload fails and propagates the error', async () => {
    const pending = Promise.withResolvers<{ url: string }>();
    const { result } = setup(() => pending.promise);
    let error: unknown;
    act(() => {
      void result.current
        .uploadInlineImage(file)
        .catch((rejection: unknown) => (error = rejection));
    });
    expect(result.current.inlineUploadsPending).toBe(true);

    await act(async () => pending.reject(new Error('Upload failed')));
    expect(result.current.inlineUploadsPending).toBe(false);
    expect(error).toEqual(new Error('Upload failed'));
  });

  it('stays pending until every concurrent upload settles', async () => {
    const first = Promise.withResolvers<{ url: string }>();
    const second = Promise.withResolvers<{ url: string }>();
    const uploads = [first.promise, second.promise];
    const { result } = setup(() => uploads.shift() ?? first.promise);
    act(() => {
      void result.current.uploadInlineImage(file);
      void result.current.uploadInlineImage(file);
    });
    expect(result.current.inlineUploadsPending).toBe(true);

    await act(async () =>
      first.resolve({ url: 'https://cdn.example.com/a.png' })
    );
    expect(result.current.inlineUploadsPending).toBe(true);

    await act(async () =>
      second.resolve({ url: 'https://cdn.example.com/b.png' })
    );
    expect(result.current.inlineUploadsPending).toBe(false);
  });

  it('deletes an upload that settles after unmount', async () => {
    // Save, Back-link, or any teardown while pending: the unmount
    // flush already snapshotted empty refs, so the late result must be
    // deleted on arrival instead of tracked into a dead ref.
    const pending = Promise.withResolvers<{ url: string }>();
    const { deleteUpload, result, unmount } = setup(() => pending.promise);
    let url: string | undefined;
    act(() => {
      void result.current
        .uploadInlineImage(file)
        .then((resolved) => (url = resolved));
    });
    await act(async () => {
      unmount();
    });
    const late = 'https://cdn.example.com/media/platform/blog/late.png';
    await act(async () => {
      pending.resolve({ url: late });
    });
    await vi.waitFor(() => {
      expect(deleteUpload).toHaveBeenCalledTimes(1);
    });
    expect(url).toBe(late);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/late.png',
      variantPaths: [],
    });
  });

  it('tracks uploads after a StrictMode effect replay', async () => {
    // StrictMode runs setup-cleanup-setup: the replayed setup must
    // restore the mounted flag or every upload late-deletes. The
    // harness does not replay StrictMode effects, so rerender with
    // fresh refs deterministically replays setup-cleanup-setup on the
    // same hook instance.
    const pending = Promise.withResolvers<{ url: string }>();
    const deleteUpload = vi.fn(async () => {});
    const refs = () => ({
      savedFormRef: {
        current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
      },
    });
    const { result, rerender, unmount } = renderHook(
      ({ hookRefs }) =>
        useBlogInlineImageUpload({
          deleteUpload,
          upload: () => pending.promise,
          ...hookRefs,
        }),
      {
        initialProps: { hookRefs: refs() },
        wrapper: ({ children }: { children: ReactNode }) =>
          createElement(StrictMode, null, children),
      }
    );
    await act(async () => {
      rerender({ hookRefs: refs() });
    });
    const url = 'https://cdn.example.com/media/platform/blog/strict.png';
    act(() => {
      void result.current.uploadInlineImage(file);
    });
    await act(async () => {
      pending.resolve({ url });
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => {
      expect(deleteUpload).toHaveBeenCalledTimes(1);
    });
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/strict.png',
      variantPaths: [],
    });
  });

  it('deletes live-only uploads when abandoning an unsaved form', async () => {
    // Upload-then-Back without saving: the live form references media
    // that exists nowhere else, so teardown must delete it. Only a
    // successfully submitted payload earns retention.
    const abandoned =
      'https://cdn.example.com/media/platform/blog/abandoned-inline.png';
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: abandoned,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      unmount();
    });
    await vi.waitFor(() => {
      expect(deleteUpload).toHaveBeenCalledTimes(1);
    });
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/abandoned-inline.png',
      variantPaths: [],
    });
  });

  it('keeps uploads the saved payload references on teardown', async () => {
    const saved =
      'https://cdn.example.com/media/platform/blog/saved-inline.png';
    const { deleteUpload, result, savedFormRef, unmount } = setup(async () => ({
      url: saved,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    savedFormRef.current = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      content: `<p>Body</p><img src="${saved}">`,
    };
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).not.toHaveBeenCalled();
  });
});
