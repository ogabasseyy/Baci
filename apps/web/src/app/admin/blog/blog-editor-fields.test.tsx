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

describe('BlogEditorFields', () => {
  it('forwards the import reset key to the rich-text editor', () => {
    renderComponent({ contentResetKey: 2 });
    expect(screen.getByLabelText('Blog editor content')).toHaveAttribute(
      'data-reset-key',
      '2'
    );
  });
  it('renders all key editor controls and creates mode submit label', () => {
    renderComponent();

    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.getByLabelText('Author')).toBeInTheDocument();
    expect(screen.getByLabelText('Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Excerpt')).toBeInTheDocument();
    expect(screen.getByLabelText('Featured Image URL')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Featured image alt text')
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Tags (comma-separated)')).toBeInTheDocument();
    expect(screen.getByLabelText('SEO Title')).toBeInTheDocument();
    expect(screen.getByLabelText('SEO Description')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create Post' })
    ).toBeInTheDocument();
  });

  it('applies field changes through onFormChange', () => {
    const ctx = renderComponent();

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'A better title' },
    });
    fireEvent.change(screen.getByLabelText('Slug'), {
      target: { value: 'a-better-title' },
    });
    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'published' },
    });

    expect(ctx.getCurrentForm().title).toBe('A better title');
    expect(ctx.getCurrentForm().slug).toBe('a-better-title');
    expect(ctx.getCurrentForm().status).toBe('published');
  });

  it('clears image metadata when the cover URL is removed', () => {
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_alt: 'Imported cover description',
        featured_image_height: 675,
        featured_image_url: 'https://cdn.example.com/cover.webp',
        featured_image_variants: {
          landscape_16x9: 'https://cdn.example.com/cover-16x9.webp',
        },
        featured_image_width: 1200,
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: '' },
    });

    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: '',
      featured_image_height: null,
      featured_image_url: '',
      featured_image_variants: {},
      featured_image_width: null,
    });
  });

  it('clears alt text when the cover URL is swapped', () => {
    const ctx = renderComponent({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        featured_image_alt: 'Cover description',
        featured_image_height: 675,
        featured_image_url: 'https://cdn.example.com/cover.webp',
        featured_image_width: 1200,
      },
    });

    fireEvent.change(screen.getByLabelText('Featured Image URL'), {
      target: { value: 'https://cdn.example.com/other.webp' },
    });

    expect(ctx.getCurrentForm()).toMatchObject({
      featured_image_alt: '',
      featured_image_alt_edited: false,
      featured_image_height: 675,
      featured_image_url: 'https://cdn.example.com/other.webp',
      featured_image_width: 1200,
    });
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

  it('forwards content and inline image events from BlogEditor', () => {
    const ctx = renderComponent();

    fireEvent.change(screen.getByLabelText('Blog editor content'), {
      target: { value: 'Updated article body' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Trigger inline upload' })
    );

    expect(ctx.onContentChange).toHaveBeenCalledWith('Updated article body');
    expect(mockInlineUploadTrigger).toHaveBeenCalledTimes(1);
    expect(ctx.onInlineImageUpload).toHaveBeenCalledTimes(1);
  });

  it('disables featured upload and submit buttons during loading states', () => {
    renderComponent({
      isEditMode: true,
      saving: true,
      uploadingFeatured: true,
    });

    const uploadButton = screen.getByRole('button', {
      name: 'Upload featured image',
    });
    const submitButton = screen.getByRole('button', { name: 'Save Changes' });

    expect(uploadButton).toBeDisabled();
    expect(submitButton).toBeDisabled();
  });

  it('invokes featured upload and submit callbacks when enabled', () => {
    const ctx = renderComponent({
      isEditMode: true,
      saving: false,
      uploadingFeatured: false,
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Upload featured image' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    expect(ctx.onUploadFeatured).toHaveBeenCalledTimes(1);
    expect(ctx.onSubmit).toHaveBeenCalledTimes(1);
  });

  it('preserves featured metadata while editing the image url', () => {
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
    expect(ctx.getCurrentForm().featured_image_width).toBe(1200);
    expect(ctx.getCurrentForm().featured_image_height).toBe(675);
    expect(ctx.getCurrentForm().featured_image_variants).toEqual({
      desktop: 'https://cdn.example.com/platform/blog/source/desktop.webp',
    });
  });
});
