import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogInlineImageUpload } from './use-blog-inline-image-upload';

const file = new File(['image'], 'inline.png');

const discardDraft = {
  ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
  content: '<p>Imported body</p>',
};

function reuseDraft(url: string) {
  return {
    ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
    content: `<p>Body</p><img src="${url}">`,
  };
}

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

  it('deletes settled uploads the draft does not reference', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
  });

  it('retains settled uploads embedded in the draft body', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(
        reuseDraft('https://cdn.example.com/media/platform/blog/inline-1.png')
      );
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => unmount());
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('deletes a retained upload when a second import discards it', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(
        reuseDraft('https://cdn.example.com/media/platform/blog/inline-1.png')
      );
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
  });

  it('batches cleanup above the shared delete budget into one call', async () => {
    let count = 0;
    const { deleteUpload, result, unmount } = setup(async () => {
      count += 1;
      return {
        url: `https://cdn.example.com/media/platform/blog/session-${count}.png`,
      };
    });
    for (let index = 0; index < 31; index += 1) {
      await act(async () => {
        await result.current.uploadInlineImage(file);
      });
    }
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => unmount());
    // The platform_blog_media_delete bucket allows 30 requests per
    // minute shared with featured cleanup: 31 uploads must collapse
    // into a single DELETE instead of one call per upload.
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/session-1.png',
      variantPaths: Array.from(
        { length: 30 },
        (_, index) => `platform/blog/session-${index + 2}.png`
      ),
    });
  });

  it('defers deletion until unmount and cancels on reuse', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/inline-1.png';
    const { deleteUpload, formRef, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    // Nothing is dispatched while a later import could reuse it: an
    // aborted fetch cannot recall a DELETE the server already ran.
    expect(deleteUpload).not.toHaveBeenCalled();
    const reuse = reuseDraft(reused);
    await act(async () => {
      result.current.cleanupSettledInlineUploads(reuse);
    });
    // The accepted import applies its draft to the live form, which
    // the unmount flush consults.
    formRef.current = reuse;
    await act(async () => unmount());
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('flushes a re-dropped upload after a reuse cancels it', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/inline-1.png';
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(reuseDraft(reused));
    });
    // A later import that drops the reused upload stages it again,
    // and the unmount flush deletes it then.
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
  });

  it('excludes live-form keeps from the unmount flush', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/inline-1.png';
    const { deleteUpload, formRef, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    // Manual edits after the last import can re-embed a staged path,
    // so the flush consults the live form rather than the draft.
    formRef.current = reuseDraft(reused);
    await act(async () => unmount());
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('keeps media the saved payload contains despite later live edits', async () => {
    // Deferred-save race: a staged upload is re-embedded, Create is
    // clicked, and the URL is removed before the request completes.
    // The server saves the submitted payload, so the flush must
    // consult that snapshot — not the newer live form.
    const reused = 'https://cdn.example.com/media/platform/blog/inline-1.png';
    const { deleteUpload, formRef, result, savedFormRef, unmount } = setup(
      async () => ({ url: reused })
    );
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    savedFormRef.current = reuseDraft(reused);
    formRef.current = discardDraft;
    await act(async () => unmount());
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('ignores unmount flush failures', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
    }));
    deleteUpload.mockRejectedValueOnce(new Error('Delete failed'));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    await act(async () => unmount());
    // No session is left to retry in: the failure leaks silently
    // instead of throwing out of the unmount.
    expect(deleteUpload).toHaveBeenCalledTimes(1);
  });
});
