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
  const formRef = { current: DEFAULT_PLATFORM_BLOG_FORM_STATE };
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef: { current: null },
      deleteUpload,
      formRef,
      setForm,
      toast,
      upload,
    });
    return { ...uploader, form };
  });
  return { ...hook, deleteUpload, formRef, toast };
}

const discardDraft = {
  ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
  content: '<p>Imported body</p>',
};

describe('useBlogFeaturedImageUpload cleanup', () => {
  it('batches cleanup above the shared delete budget into one call', async () => {
    let count = 0;
    const { deleteUpload, result, unmount } = setup(async () => {
      count += 1;
      return {
        url: `https://cdn.example.com/media/platform/blog/session-${count}.webp`,
        variants: {
          landscape_16x9: `https://cdn.example.com/media/platform/blog/session-${count}/landscape_16x9.webp`,
        },
      };
    });
    for (let index = 0; index < 31; index += 1) {
      await act(async () => {
        await result.current.uploadFeatured(file);
      });
    }
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    expect(deleteUpload).not.toHaveBeenCalled();
    await act(async () => {
      unmount();
    });
    // The platform_blog_media_delete bucket allows 30 requests per
    // minute shared with inline cleanup: 31 uploads (62 objects)
    // must collapse into a single DELETE instead of one call each.
    expect(deleteUpload).toHaveBeenCalledTimes(1);
    const [, ...expectedRest] = Array.from({ length: 31 }, (_, index) => [
      `platform/blog/session-${index + 1}.webp`,
      `platform/blog/session-${index + 1}/landscape_16x9.webp`,
    ]).flat();
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/session-1.webp',
      variantPaths: expectedRest,
    });
  });

  it('defers deletion until unmount and cancels on reuse', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, formRef, result, unmount } = setup(async () => ({
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
    // The accepted import applies its draft to the live form, which
    // the unmount flush consults.
    formRef.current = reuseDraft;
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).not.toHaveBeenCalled();
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

  it('excludes live-form keeps from the unmount flush', async () => {
    const reused = 'https://cdn.example.com/media/platform/blog/cover.webp';
    const { deleteUpload, formRef, result, unmount } = setup(async () => ({
      url: reused,
    }));
    await act(async () => {
      await result.current.uploadFeatured(file);
    });
    await act(async () => {
      result.current.cleanupSettledSessionUploads(discardDraft);
    });
    // Manual edits after the last import can re-embed a staged path,
    // so the flush consults the live form rather than the draft.
    formRef.current = {
      ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
      featured_image_url: reused,
    };
    await act(async () => {
      unmount();
    });
    expect(deleteUpload).not.toHaveBeenCalled();
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
});
