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
  }
) {
  const toast = vi.fn();
  const hook = renderHook(() => {
    const [form, setForm] = useState(DEFAULT_PLATFORM_BLOG_FORM_STATE);
    const uploader = useBlogFeaturedImageUpload({
      coverStashRef,
      setForm,
      toast,
      upload,
    });
    return { ...uploader, form, setForm };
  });
  return { ...hook, coverStashRef, toast };
}

// Mirrors the editor client: the snapshot is the live form alt at click time.
function startUpload(hook: ReturnType<typeof setup>['result'], file: File) {
  return hook.current.uploadFeatured(file, {
    alt: hook.current.form.featured_image_alt,
    altEdited: hook.current.form.featured_image_alt_edited ?? false,
  });
}

describe('useBlogFeaturedImageUpload pending alt', () => {
  it('preserves alt text typed while a replacement upload is pending', async () => {
    const pending = Promise.withResolvers<typeof uploadedImage>();
    const { result } = setup(() => pending.promise);
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/old.webp',
        featured_image_alt: 'The previous cover',
      })
    );
    act(() => {
      void startUpload(result, file);
    });
    act(() =>
      result.current.setForm((current) => ({
        ...current,
        featured_image_alt: 'Alt for the new cover',
        featured_image_alt_edited: true,
      }))
    );
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe(
      'Alt for the new cover'
    );
    expect(result.current.form.featured_image_alt_edited).toBe(true);
  });

  it('clears pre-upload edited alt text unchanged during a replacement', async () => {
    // The edited flag alone must not win: text (and flag) that predates
    // the upload generation describes the replaced cover, so it orphans.
    const pending = Promise.withResolvers<typeof uploadedImage>();
    const { result } = setup(() => pending.promise);
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/old.webp',
        featured_image_alt: 'The previous cover',
        featured_image_alt_edited: true,
      })
    );
    act(() => {
      void startUpload(result, file);
    });
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe('');
    expect(result.current.form.featured_image_alt_edited).toBe(false);
  });

  it('keeps the edited flag when mid-flight typing converges to the snapshot', async () => {
    // Type-then-clear during the flight converges back to the snapshot
    // value, but the flag flip proves the user touched the field for the
    // incoming image, so the explicit empty alt survives the replacement.
    const pending = Promise.withResolvers<typeof uploadedImage>();
    const { result } = setup(() => pending.promise);
    act(() =>
      result.current.setForm({
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/old.webp',
      })
    );
    act(() => {
      void startUpload(result, file);
    });
    act(() =>
      result.current.setForm((current) => ({
        ...current,
        featured_image_alt: 'A draft thought',
        featured_image_alt_edited: true,
      }))
    );
    act(() =>
      result.current.setForm((current) => ({
        ...current,
        featured_image_alt: '',
        featured_image_alt_edited: true,
      }))
    );
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe('');
    expect(result.current.form.featured_image_alt_edited).toBe(true);
  });
});
