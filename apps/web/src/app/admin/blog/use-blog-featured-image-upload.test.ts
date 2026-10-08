import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogCoverState,
} from './blog-types';
import { useBlogFeaturedImageUpload } from './use-blog-featured-image-upload';

const uploadedImage = {
  url: 'https://cdn.example.com/upload.webp',
  width: 1200,
  height: 675,
  variants: { landscape_16x9: 'https://cdn.example.com/landscape.webp' },
};
const file = new File(['image'], 'cover.png');

function setup(
  upload: (file: File) => Promise<typeof uploadedImage>,
  coverStashRef: { current: PlatformAdminBlogCoverState | null } = {
    current: null,
  },
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void> = vi.fn().mockResolvedValue(undefined)
) {
  const toast = vi.fn();
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef,
      deleteUpload,
      setForm,
      toast,
      upload,
    });
    return { ...uploader, form, setForm };
  });
  return { ...hook, coverStashRef, deleteUpload, toast };
}

describe('useBlogFeaturedImageUpload', () => {
  it('clears imported alt text when a replacement cover succeeds', async () => {
    const { result } = setup(vi.fn().mockResolvedValue(uploadedImage));
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/old.webp',
        featured_image_alt: 'The previous cover',
      })
    );
    await act(async () => result.current.uploadFeatured(file));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe('');
    expect(result.current.form.featured_image_alt_edited).toBe(false);
  });

  it('clears a stashed pre-diversion cover when the upload succeeds', async () => {
    const coverStashRef = {
      current: {
        alt: 'Stale',
        altEdited: false,
        height: 675,
        url: 'https://cdn.example.com/stale.webp',
        variants: {},
        width: 1200,
      },
    };
    const { result } = setup(
      vi.fn().mockResolvedValue(uploadedImage),
      coverStashRef
    );
    await act(async () => result.current.uploadFeatured(file));
    expect(coverStashRef.current).toBeNull();
  });

  it('preserves hand-typed alt text on a first upload with no prior cover', async () => {
    const { result } = setup(vi.fn().mockResolvedValue(uploadedImage));
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_alt: 'Typed before uploading',
        featured_image_alt_edited: true,
      })
    );
    await act(async () => result.current.uploadFeatured(file));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe(
      'Typed before uploading'
    );
    expect(result.current.form.featured_image_alt_edited).toBe(true);
  });

  it('preserves alt text when a re-upload resolves to the same URL', async () => {
    const { result } = setup(vi.fn().mockResolvedValue(uploadedImage));
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: uploadedImage.url,
        featured_image_alt: 'The current cover',
        featured_image_alt_edited: true,
      })
    );
    await act(async () => result.current.uploadFeatured(file));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe('The current cover');
    expect(result.current.form.featured_image_alt_edited).toBe(true);
  });

  it('preserves existing alt text when replacement fails', async () => {
    const { result } = setup(
      vi.fn().mockRejectedValue(new Error('Upload failed'))
    );
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_alt: 'The current cover',
      })
    );
    await act(async () => result.current.uploadFeatured(file));
    expect(result.current.form.featured_image_alt).toBe('The current cover');
  });

  it('applies a completed upload with all image metadata', async () => {
    const { result, toast } = setup(vi.fn().mockResolvedValue(uploadedImage));
    await act(async () => result.current.uploadFeatured(file));
    expect(result.current.form).toMatchObject({
      featured_image_url: uploadedImage.url,
      featured_image_width: 1200,
      featured_image_height: 675,
      featured_image_variants: uploadedImage.variants,
    });
    expect(result.current.uploadingFeatured).toBe(false);
    expect(toast).toHaveBeenCalledWith({ title: 'Featured image uploaded' });
  });

  it.each([
    'success',
    'failure',
  ] as const)('ignores an invalidated upload finishing with %s after an import', async (outcome) => {
    const pending = Promise.withResolvers<typeof uploadedImage>();
    const { result, toast } = setup(() => pending.promise);
    act(() => {
      void result.current.uploadFeatured(file);
    });
    expect(result.current.uploadingFeatured).toBe(true);
    act(() => {
      result.current.invalidateFeaturedUploads();
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/handoff.webp',
        featured_image_width: 1600,
        featured_image_alt: 'Imported cover',
      });
    });
    await act(async () => {
      if (outcome === 'success') pending.resolve(uploadedImage);
      else pending.reject(new Error('Old upload failed'));
    });
    expect(result.current.form.featured_image_url).toBe(
      'https://cdn.example.com/handoff.webp'
    );
    expect(result.current.form.featured_image_width).toBe(1600);
    expect(result.current.form.featured_image_alt).toBe('Imported cover');
    expect(result.current.uploadingFeatured).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('deletes an invalidated upload that succeeds after an import', async () => {
    // The route has already persisted the source and variants, so the
    // discarded result must be cleaned up instead of leaking.
    const managedUpload = {
      ...uploadedImage,
      url: 'https://cdn.example.com/media/platform/blog/stale.webp',
      variants: {
        landscape_16x9:
          'https://cdn.example.com/media/platform/blog/stale/landscape_16x9.webp',
      },
    };
    const pending = Promise.withResolvers<typeof uploadedImage>();
    const deleteUpload = vi.fn().mockResolvedValue(undefined);
    const { result } = setup(
      () => pending.promise,
      { current: null },
      deleteUpload
    );
    act(() => {
      void result.current.uploadFeatured(file);
    });
    act(() => {
      result.current.invalidateFeaturedUploads();
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/handoff.webp',
      });
    });
    await act(async () => pending.resolve(managedUpload));
    expect(deleteUpload).toHaveBeenCalledWith({
      path: 'platform/blog/stale.webp',
      variantPaths: ['platform/blog/stale/landscape_16x9.webp'],
    });
    expect(result.current.form.featured_image_url).toBe(
      'https://cdn.example.com/handoff.webp'
    );
  });

  it('reports cleanup failure without touching the imported form', async () => {
    const managedUpload = {
      ...uploadedImage,
      url: 'https://cdn.example.com/media/platform/blog/stale.webp',
    };
    const pending = Promise.withResolvers<typeof uploadedImage>();
    const deleteUpload = vi.fn().mockRejectedValue(new Error('Delete failed'));
    const { result, toast } = setup(
      () => pending.promise,
      { current: null },
      deleteUpload
    );
    act(() => {
      void result.current.uploadFeatured(file);
    });
    act(() => {
      result.current.invalidateFeaturedUploads();
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/handoff.webp',
      });
    });
    await act(async () => pending.resolve(managedUpload));
    expect(deleteUpload).toHaveBeenCalled();
    expect(result.current.form.featured_image_url).toBe(
      'https://cdn.example.com/handoff.webp'
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Could not remove abandoned upload',
        variant: 'destructive',
      })
    );
  });

  it('does not let an older upload clear the new upload loading state', async () => {
    const old = Promise.withResolvers<typeof uploadedImage>();
    const newer = Promise.withResolvers<typeof uploadedImage>();
    const upload = vi
      .fn()
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(newer.promise);
    const { result } = setup(upload);
    act(() => {
      void result.current.uploadFeatured(file);
    });
    act(() => {
      result.current.invalidateFeaturedUploads();
      void result.current.uploadFeatured(file);
    });
    await act(async () => old.resolve(uploadedImage));
    expect(result.current.uploadingFeatured).toBe(true);
    await act(async () =>
      newer.resolve({
        ...uploadedImage,
        url: 'https://cdn.example.com/new.webp',
      })
    );
    expect(result.current.uploadingFeatured).toBe(false);
    expect(result.current.form.featured_image_url).toBe(
      'https://cdn.example.com/new.webp'
    );
  });

  it('reports a current upload failure without changing the form', async () => {
    const { result, toast } = setup(
      vi.fn().mockRejectedValue(new Error('Upload failed'))
    );
    await act(async () => result.current.uploadFeatured(file));
    expect(result.current.form).toEqual(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    expect(result.current.uploadingFeatured).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Upload failed',
        description: 'Upload failed',
      })
    );
  });
});
