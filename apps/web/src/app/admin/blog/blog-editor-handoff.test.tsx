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
    onUploadFeatured,
    onSubmit,
  }: {
    form: PlatformAdminBlogFormState;
    contentResetKey: number;
    onFormChange: (form: PlatformAdminBlogFormState) => void;
    onContentDirty?: () => void;
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

it('blocks a pending handoff read once the create request starts', async () => {
  render(<BlogEditorClient mode="create" />);
  importHandoff();
  await screen.findByText(
    'Draft loaded for review. It has not been saved or published.'
  );
  const pendingRead = Promise.withResolvers<string>();
  const file = new File([], 'pending.json');
  vi.spyOn(file, 'text').mockReturnValue(pendingRead.promise);
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: { files: [file] },
  });
  const pendingSave = Promise.withResolvers<Response>();
  fetchWithCsrf.mockReturnValueOnce(pendingSave.promise);
  fireEvent.click(screen.getByRole('button', { name: 'Create Post' }));
  expect(screen.getByLabelText('Review handoff JSON')).toBeDisabled();
  await act(async () =>
    pendingRead.resolve(
      JSON.stringify({ ...handoff, title: 'Discarded newer article' })
    )
  );
  expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article');
  await act(async () =>
    pendingSave.resolve(
      new Response(JSON.stringify({ error: 'Test failure' }), { status: 500 })
    )
  );
  expect(screen.getByLabelText('Review handoff JSON')).toBeEnabled();
});

it('imports directly into an unchanged form and resets the rich-text editor', async () => {
  const confirm = vi.spyOn(window, 'confirm');
  render(<BlogEditorClient mode="create" />);
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  expect(confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Editor reset')).toHaveTextContent('1');
  expect(screen.getByLabelText('Article')).toHaveTextContent('Imported body');
});

it('confirms body edits before their debounced form update arrives', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BlogEditorClient mode="create" />);
  fireEvent.click(
    screen.getByRole('button', { name: 'Type pending body edit' })
  );
  importHandoff();
  expect(
    await screen.findByText('Import cancelled. Your article is unchanged.')
  ).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Editor reset')).toHaveTextContent('0');
});

it('protects an unsaved imported article when importing again without intent', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BlogEditorClient mode="create" />);
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  expect(confirm).not.toHaveBeenCalled();
  importHandoff();
  expect(
    await screen.findByText('Import cancelled. Your article is unchanged.')
  ).toBeInTheDocument();
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Article')).toHaveTextContent('Imported body');
});

it('keeps an imported image when an older featured upload finishes later', async () => {
  const pending = Promise.withResolvers<Response>();
  fetchWithCsrf.mockReturnValueOnce(pending.promise);
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
          url: 'https://cdn.example.com/stale.webp',
          width: 1200,
          height: 675,
          variants: {},
        }),
        { status: 200 }
      )
    )
  );
  expect(screen.getByLabelText('Featured image')).toHaveTextContent(
    'https://cdn.example.com/cover.webp'
  );
});

it('preserves changed content on cancellation and replaces it after confirmation', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BlogEditorClient mode="create" />);
  fireEvent.change(screen.getByLabelText('Draft title'), {
    target: { value: 'My article' },
  });
  importHandoff();
  await waitFor(() =>
    expect(
      screen.getByText('Import cancelled. Your article is unchanged.')
    ).toBeInTheDocument()
  );
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Draft title')).toHaveValue('My article');
  expect(screen.getByLabelText('Editor reset')).toHaveTextContent('0');
  confirm.mockReturnValue(true);
  importHandoff();
  await waitFor(() =>
    expect(screen.getByLabelText('Draft title')).toHaveValue('Imported article')
  );
  expect(screen.getByLabelText('Editor reset')).toHaveTextContent('1');
});

it('confirms edits made while the imported file is still being read', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<BlogEditorClient mode="create" />);
  let finishRead: (text: string) => void = () => {};
  const file = new File([], 'handoff.json');
  vi.spyOn(file, 'text').mockReturnValue(
    new Promise<string>((resolve) => {
      finishRead = resolve;
    })
  );
  fireEvent.change(screen.getByLabelText('Review handoff JSON'), {
    target: { files: [file] },
  });
  fireEvent.change(screen.getByLabelText('Draft title'), {
    target: { value: 'Typed during import' },
  });
  await act(async () => {
    finishRead(JSON.stringify(handoff));
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Draft title')).toHaveValue(
    'Typed during import'
  );
  expect(screen.getByLabelText('Editor reset')).toHaveTextContent('0');
});
