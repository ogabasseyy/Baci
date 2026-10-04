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
vi.mock('@/app/admin/blog/blog-editor-fields', () => ({
  BlogEditorFields: ({
    form,
    contentResetKey,
    onFormChange,
  }: {
    form: PlatformAdminBlogFormState;
    contentResetKey: number;
    onFormChange: (form: PlatformAdminBlogFormState) => void;
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
