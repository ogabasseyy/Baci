import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
    onInlineImageUpload,
    onUploadFeatured,
    onSubmit,
  }: {
    form: PlatformAdminBlogFormState;
    contentResetKey: number;
    onFormChange: (form: PlatformAdminBlogFormState) => void;
    onContentDirty?: () => void;
    onCoverUrlEdit: () => void;
    onInlineImageUpload: (file: File) => Promise<string>;
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
          void onInlineImageUpload(new File(['image'], 'inline.png'));
        }}
      >
        Upload inline
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

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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

it('deletes a settled inline upload when an accepted import replaces it', async () => {
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        url: 'https://cdn.example.com/media/platform/blog/inline-1.png',
      }),
      { status: 200 }
    )
  );
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(JSON.stringify({ success: true }), { status: 200 })
  );
  fetchWithCsrf.mockClear();
  const { unmount } = render(<BlogEditorClient mode="create" />);
  fireEvent.click(screen.getByRole('button', { name: 'Upload inline' }));
  await waitFor(() => expect(fetchWithCsrf).toHaveBeenCalled());
  await act(async () => {});
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  // The inline upload settled before the import, so pending guards no
  // longer cover it: the discarded body strands the persisted file
  // unless the staged delete flushes on unmount.
  unmount();
  await waitFor(() =>
    expect(fetchWithCsrf).toHaveBeenCalledWith(
      '/api/admin/blog/upload',
      expect.objectContaining({
        body: JSON.stringify({
          path: 'platform/blog/inline-1.png',
          variantPaths: [],
        }),
        method: 'DELETE',
      })
    )
  );
});

it('deletes an imported-then-abandoned upload and its orphaned variant', async () => {
  fetchWithCsrf.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        url: 'https://cdn.example.com/media/platform/blog/embedded.webp',
        width: 1200,
        height: 675,
        variants: {
          landscape_16x9:
            'https://cdn.example.com/media/platform/blog/embedded/landscape_16x9.webp',
        },
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
      'https://cdn.example.com/media/platform/blog/embedded.webp'
    )
  );
  // The draft uses a different cover but embeds the uploaded source
  // in its body. Nothing is saved, so teardown deletes the revived
  // source together with the orphaned variant: only the last saved
  // payload earns retention.
  const embeddedHandoff = {
    ...handoff,
    content_html:
      '<p>Imported body</p><img src="https://cdn.example.com/media/platform/blog/embedded.webp">',
  };
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: {
      files: [new File([JSON.stringify(embeddedHandoff)], 'handoff.json')],
    },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  unmount();
  await waitFor(() =>
    expect(
      fetchWithCsrf.mock.calls.filter(
        ([, options]) => options?.method === 'DELETE'
      )
    ).toHaveLength(1)
  );
  expect(fetchWithCsrf).toHaveBeenCalledWith(
    '/api/admin/blog/upload',
    expect.objectContaining({
      body: JSON.stringify({
        path: 'platform/blog/embedded.webp',
        variantPaths: ['platform/blog/embedded/landscape_16x9.webp'],
      }),
      method: 'DELETE',
    })
  );
});

it('drops hidden paragraphs from the imported article', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BlogEditorClient mode="create" />);
  const concealedHandoff = {
    ...handoff,
    content_html: '<p class="hidden">Draft note</p><p>Visible article</p>',
  };
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: {
      files: [new File([JSON.stringify(concealedHandoff)], 'handoff.json')],
    },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  // The editor drops input classes, so a concealed paragraph would
  // surface on mount: the import removes hidden content instead.
  expect(screen.getByLabelText('Article')).toHaveTextContent('Visible article');
  expect(screen.getByLabelText('Article')).not.toHaveTextContent('Draft note');
});

it.each([
  ['invisible'],
  ['text-transparent'],
])('drops %s paragraphs from the imported article', async (concealed) => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<BlogEditorClient mode="create" />);
  const concealedHandoff = {
    ...handoff,
    content_html: `<p class="${concealed}">Draft note</p><p>Visible article</p>`,
  };
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: {
      files: [new File([JSON.stringify(concealedHandoff)], 'handoff.json')],
    },
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  expect(screen.getByLabelText('Article')).toHaveTextContent('Visible article');
  expect(screen.getByLabelText('Article')).not.toHaveTextContent('Draft note');
});
