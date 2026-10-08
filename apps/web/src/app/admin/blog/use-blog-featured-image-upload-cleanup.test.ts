import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
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
  const toast = vi.fn();
  const savedFormRef = {
    current: null as typeof DEFAULT_PLATFORM_BLOG_FORM_STATE | null,
  };
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef: { current: null },
      deleteUpload,
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

describe('useBlogFeaturedImageUpload cleanup', () => {
  it('defers deletion until unmount, then deletes unsaved reuses', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    // Nothing is dispatched while a later import could reuse it: an
    // aborted fetch cannot recall a DELETE the server already ran.
    expect(deleteUpload).not.toHaveBeenCalled();
    const reuseDraft = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      content: '<p>Imported body</p>',
      featured_image_url: reused,
    };
    await act(async () => {
      result.current.cleanupSettledSessionUploads(reuseDraft);
    });
    // The reuse revives the result, but the draft was never saved, so
    // teardown deletes it instead of retaining live-form references.
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
    });
  });

  it('flushes a re-dropped upload after a reuse cancels it', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
        featured_image_url: reused,
      });
    });
    // A later import that drops the reused upload stages it again,
    // and the unmount flush deletes it then.
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
    });
  });

  it('deletes manually re-embedded uploads without a save', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    // Manual edits after the last import re-embed the staged path, but
    // the form is abandoned without saving: only the last saved
    // payload earns retention, so teardown deletes it.
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
    });
  });

  it('ignores unmount flush failures', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/settled.webp',
    }));
    deleteUpload.mockRejectedValueOnce(new Error('Delete failed'));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    await act(async () => {
      unmount();
    });
    // No session is left to retry in: the failure leaks silently
    // instead of throwing out of the unmount.
    expect(deleteUpload).toHaveBeenCalledTimes(1);
  });

  it('keeps media the saved payload contains', async () => {
    // The server saved the submitted payload, so teardown retains it.
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, result, savedFormRef, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    savedFormRef.current = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      content: '<p>Imported body</p>',
      featured_image_url: reused,
    };
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).not.toHaveBeenCalled();
  });

  it('flushes settled uploads discarded without an import', async () => {
    // Upload, manually replace the URL, then navigate away: the
    // result never entered a cleanup, so the flush must cover
    // settled tracking too — not just staged results.
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/cover.webp',
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
    });
  });

  it('lists each object once across retain/discard cycles', async () => {
    // Retain/discard cycling must move staged entries, not copy
    // them: copying doubles the tracked entries every cycle.
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const reuseDraft = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      content: '<p>Imported body</p>',
      featured_image_url: reused,
    };
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    for (let cycle = 0; cycle < 10; cycle += 1) {
      await act(async () => {
        result.current.cleanupSettledSessionUploads(reuseDraft);
      });
      await act(async () => {
        result.current.cleanupSettledSessionUploads(discardDraft);
      });
    }
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: [],
    });
  });

  it('trims retained uploads to their kept paths', async () => {
    const { deleteUpload, result, unmount } = setup(async () => ({
      url: 'https://cdn.example.com/media/platform/blog/cover.webp',
      variants: {
        landscape_16x9:
          'https://cdn.example.com/media/platform/blog/cover/landscape_16x9.webp',
      },
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    // First import keeps the cover but not its variant: the trimmed
    // result stays tracked while the whole result stages.
    await act(async () => {
      result.current.cleanupSettledSessionUploads({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        content: '<p>Imported body</p>',
        featured_image_url:
          'https://cdn.example.com/media/platform/blog/cover.webp',
      });
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    // Second import discards the cover too: the flush deletes both
    // objects in one call without listing either twice.
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/cover.webp',
      variantPaths: ['platform/blog/cover/landscape_16x9.webp'],
    });
  });

  it('deletes a featured upload that settles after unmount', async () => {
    // The unmount flush snapshotted empty refs, so the late result can
    // never be tracked: delete the persisted source on arrival instead
    // of stranding it.
    const pending = Promise.withResolvers<{ url: string }>();
    const { deleteUpload, result, unmount } = setup(() => pending.promise);
    act(() => {
      void result.current.uploadFeatured(file);
    });
    await act(async () => {
      unmount();
    });
    const late = 'https://cdn.example.com/media/platform/blog/late-cover.webp';
    await act(async () => {
      pending.resolve({ url: late });
    });
    await vi.waitFor(() => {
      expect(deleteUpload).toHaveBeenCalledTimes(1);
    });
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/late-cover.webp',
      variantPaths: [],
    });
  });
});
