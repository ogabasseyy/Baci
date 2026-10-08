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

it('keeps an imported image and deletes the stale upload when an older featured upload finishes later', async () => {
  const pending = Promise.withResolvers<Response>();
  fetchWithCsrf.mockReturnValueOnce(pending.promise);
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
  render(<BlogEditorClient mode="create" />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload cover' }));
  expect(fetchWithCsrf).toHaveBeenCalled();
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  await act(async () =>
    pending.resolve(
      new Response(
        JSON.stringify({
          url: 'https://cdn.example.com/media/platform/blog/stale.webp',
          width: 1200,
          height: 675,
          variants: {
            landscape_16x9:
              'https://cdn.example.com/media/platform/blog/stale/landscape_16x9.webp',
          },
        }),
        { status: 200 }
      )
    )
  );
  expect(screen.getByLabelText('Featured image')).toHaveTextContent(
    'https://cdn.example.com/cover.webp'
  );
  // The route persisted the stale upload before the import invalidated
  // it, so the discarded result is deleted instead of leaking.
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    '/api/admin/blog/upload',
    expect.objectContaining({
      body: JSON.stringify({
        path: 'platform/blog/stale.webp',
        variantPaths: ['platform/blog/stale/landscape_16x9.webp'],
      }),
      method: 'DELETE',
    })
  );
});

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
  render(<BlogEditorClient mode="create" />);
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
  // would leave its persisted objects behind: the import deletes the
  // replaced session upload instead of leaking it.
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

it('keeps a manual cover when its URL edit invalidates a pending upload', async () => {
  // Upload C pending; the reviewer instead types URL B with alt for B.
  // The manual edit takes over: C is discarded and cleaned up when it
  // resolves, and B keeps the description written for it.
  const pending = Promise.withResolvers<Response>();
  fetchWithCsrf.mockReturnValueOnce(pending.promise);
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
  render(<BlogEditorClient mode="create" />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload cover' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit cover URL' }));
  await act(async () =>
    pending.resolve(
      new Response(
        JSON.stringify({
          url: 'https://cdn.example.com/media/platform/blog/uploaded.webp',
          width: 1200,
          height: 675,
          variants: {},
        }),
        { status: 200 }
      )
    )
  );
  expect(screen.getByLabelText('Featured image')).toHaveTextContent(
    'https://cdn.example.com/manual.webp'
  );
  expect(screen.getByLabelText('Featured alt')).toHaveTextContent(
    'Manual cover'
  );
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    '/api/admin/blog/upload',
    expect.objectContaining({
      body: JSON.stringify({
        path: 'platform/blog/uploaded.webp',
        variantPaths: [],
      }),
      method: 'DELETE',
    })
  );
});
