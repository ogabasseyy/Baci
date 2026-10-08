import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { BlogEditorClient } from './blog-editor-client';
import type { PlatformAdminBlogFormState } from './blog-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const fetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));
vi.mock('@/app/admin/blog/blog-editor-fields', () => ({
  BlogEditorFields: ({
    form,
    contentResetKey,
    onFormChange,
    onContentDirty,
    onCoverUrlEdit,
    onUploadFeatured,
    onSubmit,
  }: {
    form: PlatformAdminBlogFormState;
    contentResetKey: number;
    onFormChange: (form: PlatformAdminBlogFormState) => void;
    onContentDirty?: () => void;
    onCoverUrlEdit: () => void;
    onUploadFeatured: () => void;
    onSubmit: () => void;
  }) => (
    <>
      <input
        aria-label="Draft title"
        value={form.title}
        onChange={(event) =>
          onFormChange({ ...form, title: event.target.value })
        }
      />
      <input
        aria-label="Cover URL"
        value={form.featured_image_url}
        onChange={(event) => {
          onCoverUrlEdit();
          onFormChange({
            ...form,
            featured_image_url: event.target.value,
          });
        }}
      />
      <output aria-label="Editor reset">{contentResetKey}</output>
      <output aria-label="Article">{form.content}</output>
      <button type="button" onClick={onContentDirty}>
        Type pending body edit
      </button>
      <button type="button" onClick={onUploadFeatured}>
        Upload cover
      </button>
      <output aria-label="Featured image">{form.featured_image_url}</output>
      <button type="button" onClick={onSubmit}>
        Create Post
      </button>
    </>
  ),
}));

afterEach(() => vi.restoreAllMocks());

const handoff = {
  schema_version: 'baci-blog-review-handoff/v1',
  title: 'Imported article',
  content_html: '<p>Imported body</p>',
  featured_image: { url: 'https://cdn.example.com/cover.webp' },
};

function importHandoff() {
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: { files: [new File([JSON.stringify(handoff)], 'handoff.json')] },
  });
}

it('keeps media the saved payload contains despite edits during save', async () => {
  // Deferred-save race: a staged upload is re-embedded, Create is
  // clicked, and the URL is removed before the request completes.
  // The server saves the submitted payload, so the unmount flush
  // must consult that snapshot — not the newer live form.
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        url: 'https://cdn.example.com/media/platform/blog/settled.webp',
      }),
      { status: 200 }
    )
  );
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    fireEvent.change(this, {
      target: { files: [new File(['image'], 'cover.png')] },
    });
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { unmount } = render(<BlogEditorClient mode="create" />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload cover' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Featured image')).toHaveTextContent(
      'https://cdn.example.com/media/platform/blog/settled.webp'
    )
  );
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  fireEvent.change(screen.getByLabelText('Cover URL'), {
    target: {
      value: 'https://cdn.example.com/media/platform/blog/settled.webp',
    },
  });
  const save = Promise.withResolvers<Response>();
  fetchWithCsrf.mockReturnValueOnce(save.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Create Post' }));
  await waitFor(() =>
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/posts',
      expect.objectContaining({ method: 'POST' })
    )
  );
  expect(JSON.stringify(fetchWithCsrf.mock.calls)).toContain('settled.webp');
  // Removed while the create request is in flight: the live form no
  // longer references the upload, but the submitted payload does.
  fireEvent.change(screen.getByLabelText('Cover URL'), {
    target: { value: '' },
  });
  await act(async () => {
    save.resolve(
      new Response(JSON.stringify({ id: 'new-post' }), { status: 200 })
    );
  });
  unmount();
  await act(async () => {});
  expect(
    fetchWithCsrf.mock.calls.filter(
      ([, options]) => options?.method === 'DELETE'
    )
  ).toHaveLength(0);
});
