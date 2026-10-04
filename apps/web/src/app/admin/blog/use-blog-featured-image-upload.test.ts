import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogFeaturedImageUpload } from './use-blog-featured-image-upload';

const uploadedImage = {
  url: 'https://cdn.example.com/upload.webp',
  width: 1200,
  height: 675,
  variants: { landscape_16x9: 'https://cdn.example.com/landscape.webp' },
};
const file = new File(['image'], 'cover.png');

function setup(upload: (file: File) => Promise<typeof uploadedImage>) {
  const toast = vi.fn();
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({ upload, setForm, toast });
    return { ...uploader, form, setForm };
  });
  return { ...hook, toast };
}

describe('useBlogFeaturedImageUpload', () => {
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
    expect(result.current.uploadingFeatured).toBe(false);
    expect(toast).not.toHaveBeenCalled();
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
