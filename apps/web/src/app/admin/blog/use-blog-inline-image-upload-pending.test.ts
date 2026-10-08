import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogInlineImageUpload } from './use-blog-inline-image-upload';

const file = new File(['image'], 'inline.png');

function setup(upload: (file: File) => Promise<{ url: string }>) {
  const deleteUpload = vi.fn(async () => {});
  const formRef = { current: DEFAULT_PLATFORM_BLOG_FORM_STATE };
  const savedFormRef = {
    current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
  };
  const hook = renderHook(() =>
    useBlogInlineImageUpload({ deleteUpload, formRef, savedFormRef, upload })
  );
  return { ...hook, deleteUpload, formRef, savedFormRef };
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
});
