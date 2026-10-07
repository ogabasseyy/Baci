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
});
