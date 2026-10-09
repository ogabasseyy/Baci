import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  return { ...hook, deleteUpload, savedFormRef };
}

describe('useBlogInlineImageUpload', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);
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

  it('deletes revived uploads when the reusing draft is never saved', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    const reuse = reuseDraft(
      'https://cdn.example.com/media/platform/blog/inline-1.png'
    );
    await act(async () => {
      result.current.cleanupSettledInlineUploads(reuse);
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    // The reuse revives the upload into tracking, but nothing was
    // saved: abandoning the form deletes it on teardown.
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
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

  it('defers deletion until unmount, then deletes unsaved reuses', async () => {
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
    // Nothing is dispatched while a later import could reuse it: an
    // aborted fetch cannot recall a DELETE the server already ran.
    expect(deleteUpload).not.toHaveBeenCalled();
    const reuse = reuseDraft(reused);
    await act(async () => {
      result.current.cleanupSettledInlineUploads(reuse);
    });
    // The reuse revives the upload, but the draft was never saved, so
    // teardown deletes it instead of retaining live-form references.
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
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

  it('deletes manually re-embedded uploads without a save', async () => {
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
    // Manual edits after the last import re-embed the staged path, but
    // the form is abandoned without saving: only the last saved
    // payload earns retention, so teardown deletes it.
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
  });

  it('keeps media the saved payload contains', async () => {
    // The server saved the submitted payload, so teardown retains it.
    const reused = 'https://cdn.example.com/media/platform/blog/inline-1.png';
    const { deleteUpload, result, savedFormRef, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => {
      result.current.cleanupSettledInlineUploads(discardDraft);
    });
    savedFormRef.current = reuseDraft(reused);
    await act(async () => unmount());
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('flushes settled uploads discarded without an import', async () => {
    // Upload, remove the image, then navigate away: the URL never
    // entered a cleanup, so the flush must cover settled tracking
    // too — not just staged uploads.
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
  });

  it('lists each object once across retain/discard cycles', async () => {
    // Retain/discard cycling must move staged entries, not copy
    // them: copying doubles the tracked entries every cycle.
    const reused = 'https://cdn.example.com/media/platform/blog/inline-1.png';
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadInlineImage(file);
    });
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await act(async () => {
        result.current.cleanupSettledInlineUploads(reuseDraft(reused));
      });
      await act(async () => {
        result.current.cleanupSettledInlineUploads(discardDraft);
      });
    }
    await act(async () => unmount());
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/inline-1.png',
      variantPaths: [],
    });
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
