import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogEditorFields } from './blog-editor-fields';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';

const mockInlineUploadTrigger = vi.fn();

vi.mock('@/components/blog/blog-editor', () => ({
  BlogEditor: ({
    content,
    contentResetKey,
    onChange,
    onImageUpload,
  }: {
    content: string;
    contentResetKey?: number;
    onChange: (value: string) => void;
    onImageUpload: (file: File) => Promise<string>;
  }) => (
    <div>
      <textarea
        aria-label="Blog editor content"
        data-reset-key={contentResetKey}
        value={content}
        onChange={(event) => onChange(event.target.value)}
      />
      <button
        type="button"
        onClick={() => {
          const file = new File(['img'], 'inline.png', { type: 'image/png' });
          mockInlineUploadTrigger(file);
          void onImageUpload(file);
        }}
      >
        Trigger inline upload
      </button>
    </div>
  ),
}));

type BlogEditorFieldsProps = Parameters<typeof BlogEditorFields>[0];

function renderComponent(overrides?: Partial<BlogEditorFieldsProps>) {
  const initialForm = overrides?.form
    ? { ...overrides.form }
    : { ...DEFAULT_PLATFORM_BLOG_FORM_STATE };
  const { form: _ignoredForm, ...remainingOverrides } = (overrides ??
    {}) as Partial<BlogEditorFieldsProps>;
  let currentForm = initialForm;
  const onFormChange = vi.fn((updater) => {
    currentForm =
      typeof updater === 'function' ? updater(currentForm) : updater;
  });
  const onContentChange = vi.fn();
  const onInlineImageUpload = vi
    .fn()
    .mockResolvedValue('https://cdn.example.com/inline.png');
  const onSubmit = vi.fn();
  const onUploadFeatured = vi.fn();

  render(
    <BlogEditorFields
      coverStashRef={{ current: null }}
      form={currentForm}
      isEditMode={false}
      onContentChange={onContentChange}
      onFormChange={onFormChange}
      onInlineImageUpload={onInlineImageUpload}
      onSubmit={onSubmit}
      onUploadFeatured={onUploadFeatured}
      saving={false}
      uploadingFeatured={false}
      {...remainingOverrides}
    />
  );

  return {
    getCurrentForm: () => currentForm,
    onContentChange,
    onFormChange,
    onInlineImageUpload,
    onSubmit,
    onUploadFeatured,
  };
}

describe('BlogEditorFields cover record', () => {
  it.each([
    '',
    'https://cdn.example.com/other.webp',
  ])('clears the whole cover record when the cover URL changes to %s', (url) => {
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_alt: 'Imported cover description',
        featured_image_alt_edited: true,
        featured_image_height: 675,
        featured_image_url: 'https://cdn.example.com/cover.webp',
        featured_image_variants: {
          landscape_16x9: 'https://cdn.example.com/cover-16x9.webp',
        },
        featured_image_width: 1200,
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: url },
    });

    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: '',
      featured_image_alt_edited: false,
      featured_image_height: null,
      featured_image_url: url,
      featured_image_variants: {},
      featured_image_width: null,
    });
  });

  it('restores cover metadata when a URL edit is undone', () => {
    const coverUrl = 'https://cdn.example.com/cover.webp';
    const variants = {
      landscape_16x9: 'https://cdn.example.com/cover-16x9.webp',
    };
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/other.webp',
      },
      initialCover: {
        alt: 'Cover description',
        altEdited: false,
        height: 675,
        url: coverUrl,
        variants,
        width: 1200,
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: coverUrl },
    });
    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: 'Cover description',
      featured_image_height: 675,
      featured_image_url: coverUrl,
      featured_image_variants: variants,
      featured_image_width: 1200,
    });
  });

  it('restores the stashed alt edit when a URL diversion is undone', () => {
    const coverUrl = 'https://cdn.example.com/cover.webp';
    const variants = {
      landscape_16x9: 'https://cdn.example.com/cover-16x9.webp',
    };
    // The stash holds the pre-diversion record: alt B was typed over the
    // pristine alt A before the URL moved away. (The full keystroke
    // sequence is covered in apply-cover-url-change.test.ts; the harness
    // never re-renders, so consecutive changes on one input are
    // unreliable here.)
    const coverStashRef = {
      current: {
        alt: 'Edited alt',
        altEdited: true,
        height: 675,
        url: coverUrl,
        variants,
        width: 1200,
      },
    };
    const ctx = renderComponent({
      coverStashRef,
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/other.webp',
      },
      initialCover: {
        alt: 'Cover description',
        altEdited: false,
        height: 675,
        url: coverUrl,
        variants,
        width: 1200,
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: coverUrl },
    });
    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: 'Edited alt',
      featured_image_alt_edited: true,
      featured_image_height: 675,
      featured_image_url: coverUrl,
      featured_image_variants: variants,
      featured_image_width: 1200,
    });
    expect(coverStashRef.current).toBeNull();
  });

  it('marks hand-typed alt text as edited until the cover URL changes', () => {
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_url: 'https://cdn.example.com/cover.webp',
      },
    });

    fireEvent.change(screen.getByLabelText('Featured image alt text'), {
      target: { value: 'Fresh cover' },
    });
    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: 'Fresh cover',
      featured_image_alt_edited: true,
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: 'https://cdn.example.com/other.webp' },
    });
    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: '',
      featured_image_alt_edited: false,
    });
  });

  it('keeps image metadata for whitespace-only URL edits', () => {
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_alt: 'Cover description',
        featured_image_url: 'https://cdn.example.com/cover.webp',
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: 'https://cdn.example.com/cover.webp ' },
    });

    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: 'Cover description',
    });
  });

  it('clears featured metadata while editing the image url', () => {
    const originalUrl = 'https://cdn.example.com/platform/blog/source.webp';
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_height: 675,
        featured_image_url: originalUrl,
        featured_image_variants: {
          desktop: 'https://cdn.example.com/platform/blog/source/desktop.webp',
        },
        featured_image_width: 1200,
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: 'https://example.com/new-source.webp' },
    });
    expect(ctx.getCurrentForm().featured_image_url).toBe(
      'https://example.com/new-source.webp'
    );
    expect(ctx.getCurrentForm().featured_image_width).toBeNull();
    expect(ctx.getCurrentForm().featured_image_height).toBeNull();
    expect(ctx.getCurrentForm().featured_image_variants).toEqual({});
  });
});
