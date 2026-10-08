import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBlogInlineImageUpload } from './use-blog-inline-image-upload';

const file = new File(['image'], 'inline.png');

function setup(upload: (file: File) => Promise<{ url: string }>) {
  return renderHook(() => useBlogInlineImageUpload({ upload }));
}

describe('useBlogInlineImageUpload', () => {
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
