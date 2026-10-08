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
      deleteUpload: vi.fn().mockResolvedValue(undefined),
      setForm,
      toast,
      upload,
    });
    return { ...uploader, form, setForm };
  });
  return { ...hook, coverStashRef, toast };
}

// Mirrors the alt field: every keystroke updates the form and reports the
// edit to the upload hook in the same handler.
function typeAlt(hook: ReturnType<typeof setup>['result'], value: string) {
  act(() => {
    hook.current.noteAltEdit();
    hook.current.setForm((current) => ({
      ...current,
      featured_image_alt: value,
      featured_image_alt_edited: true,
    }));
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
      void result.current.uploadFeatured(file);
    });
    typeAlt(result, 'Alt for the new cover');
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe(
      'Alt for the new cover'
    );
    expect(result.current.form.featured_image_alt_edited).toBe(true);
  });

  it('preserves already-edited alt changed and reverted during a replacement', async () => {
    // The alt was marked edited before the upload started; the user
    // retypes it mid-flight and returns to the snapshot text. Both the
    // value and the flag converge, so only an edit-activity signal can
    // still distinguish this from untouched pre-upload text.
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
      void result.current.uploadFeatured(file);
    });
    typeAlt(result, 'A mid-flight rethink');
    typeAlt(result, 'The previous cover');
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe('The previous cover');
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
      void result.current.uploadFeatured(file);
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
      void result.current.uploadFeatured(file);
    });
    typeAlt(result, 'A draft thought');
    typeAlt(result, '');
    await act(async () => pending.resolve(uploadedImage));
    expect(result.current.form.featured_image_url).toBe(uploadedImage.url);
    expect(result.current.form.featured_image_alt).toBe('');
    expect(result.current.form.featured_image_alt_edited).toBe(true);
  });
});
