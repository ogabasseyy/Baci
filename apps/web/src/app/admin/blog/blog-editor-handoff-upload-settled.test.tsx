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
      <output aria-label="Editor reset">{contentResetKey}</output>
      <output aria-label="Article">{form.content}</output>
      <button type="button" onClick={onContentDirty}>
        Type pending body edit
      </button>
      <button type="button" onClick={onUploadFeatured}>
        Upload cover
      </button>
      <button
        type="button"
        onClick={() => {
          onCoverUrlEdit();
          onFormChange({
            ...form,
            featured_image_url: 'https://cdn.example.com/manual.webp',
            featured_image_alt: 'Manual cover',
            featured_image_alt_edited: true,
          });
        }}
      >
        Edit cover URL
      </button>
      <output aria-label="Featured image">{form.featured_image_url}</output>
      <output aria-label="Featured alt">{form.featured_image_alt}</output>
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

it('deletes a settled session upload when an accepted import replaces it', async () => {
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        url: 'https://cdn.example.com/media/platform/blog/settled.webp',
        width: 1200,
        height: 675,
        variants: {
          landscape_16x9:
            'https://cdn.example.com/media/platform/blog/settled/landscape_16x9.webp',
        },
      }),
      { status: 200 }
    )
  );
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(JSON.stringify({ success: true }), { status: 200 })
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
  expect(screen.getByLabelText('Featured image')).toHaveTextContent(
    'https://cdn.example.com/cover.webp'
  );
  // The settled upload is no longer pending, so invalidation alone
  // would leave its persisted objects behind: the staged delete
  // flushes on unmount instead of leaking it.
  unmount();
  await waitFor(() =>
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/upload',
      expect.objectContaining({
        body: JSON.stringify({
          path: 'platform/blog/settled.webp',
          variantPaths: ['platform/blog/settled/landscape_16x9.webp'],
        }),
        method: 'DELETE',
      })
    )
  );
});

it('keeps a settled upload reused by the draft through an aliased URL', async () => {
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        url: 'https://cdn.example.com/media/platform/blog/aliased.webp',
        width: 1200,
        height: 675,
        variants: {},
      }),
      { status: 200 }
    )
  );
  // Scope call history to this test: earlier tests in this file leave
  // DELETE calls behind, which would trip the absence assertion below.
  // mockClear keeps the queued upload response while dropping history.
  fetchWithCsrf.mockClear();
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (
    this: HTMLInputElement
  ) {
    fireEvent.change(this, {
      target: { files: [new File(['image'], 'cover.png')] },
    });
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BlogEditorClient mode="create" />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload cover' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Featured image')).toHaveTextContent(
      'https://cdn.example.com/media/platform/blog/aliased.webp'
    )
  );
  // Same managed object, Supabase public-URL form instead of the CDN
  // form the upload returned.
  const aliasedHandoff = {
    ...handoff,
    featured_image: {
      url: 'https://project.supabase.co/storage/v1/object/public/media/platform/blog/aliased.webp',
    },
  };
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: {
      files: [new File([JSON.stringify(aliasedHandoff)], 'handoff.json')],
    },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  // The draft reuses the uploaded object, so no DELETE may fire.
  await act(async () => {});
  expect(fetchWithCsrf).not.toHaveBeenCalledWith(
    '/api/admin/blog/upload',
    expect.objectContaining({ method: 'DELETE' })
  );
});

it('deletes a retained upload when a second import discards it', async () => {
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        url: 'https://cdn.example.com/media/platform/blog/retained.webp',
        width: 1200,
        height: 675,
        variants: {},
      }),
      { status: 200 }
    )
  );
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(JSON.stringify({ success: true }), { status: 200 })
  );
  fetchWithCsrf.mockClear();
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
      'https://cdn.example.com/media/platform/blog/retained.webp'
    )
  );
  // First import reuses the session upload: it survives, but must stay
  // tracked so a later import can still delete it.
  const retainingHandoff = {
    ...handoff,
    featured_image: {
      url: 'https://cdn.example.com/media/platform/blog/retained.webp',
    },
  };
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: {
      files: [new File([JSON.stringify(retainingHandoff)], 'handoff.json')],
    },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  await act(async () => {});
  expect(fetchWithCsrf).not.toHaveBeenCalledWith(
    '/api/admin/blog/upload',
    expect.objectContaining({ method: 'DELETE' })
  );
  // Second import drops the cover: the retained object is abandoned and
  // must be deleted instead of leaking without a tracking record.
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Featured image')).toHaveTextContent(
      'https://cdn.example.com/cover.webp'
    )
  );
  unmount();
  await waitFor(() =>
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/upload',
      expect.objectContaining({
        body: JSON.stringify({
          path: 'platform/blog/retained.webp',
          variantPaths: [],
        }),
        method: 'DELETE',
      })
    )
  );
});
