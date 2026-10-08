import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlogEditorClient } from './blog-editor-client';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockToast = vi.fn();
const mockCreatePlatformBlogPost = vi.fn();
const mockDeleteBlogMediaUpload = vi.fn();
const mockUpdatePlatformBlogPost = vi.fn();
const mockFetchWithCsrf = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/app/admin/blog/blog-api', () => ({
  createPlatformBlogPost: (...args: unknown[]) =>
    mockCreatePlatformBlogPost(...args),
  deleteBlogMediaUpload: (...args: unknown[]) =>
    mockDeleteBlogMediaUpload(...args),
  updatePlatformBlogPost: (...args: unknown[]) =>
    mockUpdatePlatformBlogPost(...args),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

vi.mock('@/app/admin/blog/blog-editor-fields', () => ({
  BlogEditorFields: ({
    onFormChange,
    onInlineImageUpload,
    onSubmit,
  }: {
    onFormChange: (updater: unknown) => void;
    onInlineImageUpload: (file: File) => Promise<string>;
    onSubmit: () => void;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          onFormChange((current: Record<string, unknown>) => ({
            ...current,
            content:
              '<p>Article body</p><img src="https://cdn.example.com/media/platform/blog/inline.png">',
            title: 'Launch Faster',
          }))
        }
      >
        Fill form with inline image
      </button>
      <button type="button" onClick={() => onSubmit()}>
        Submit post
      </button>
      <button
        type="button"
        onClick={() =>
          onInlineImageUpload(
            new File(['inline'], 'inline.png', { type: 'image/png' })
          )
        }
      >
        Upload inline image
      </button>
    </div>
  ),
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('BlogEditorClient in-flight saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePlatformBlogPost.mockResolvedValue({ id: 'new-post' });
    mockUpdatePlatformBlogPost.mockResolvedValue({ id: 'post-1' });
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({
        url: 'https://cdn.example.com/media/platform/blog/inline.png',
      })
    );
  });

  it('retains submitted uploads when unmounting before the save resolves', async () => {
    // Submit-then-Back while the create request is in flight: teardown
    // must keep the submitted snapshot instead of deleting media the
    // later successful mutation points at.
    let resolveSave!: (value: unknown) => void;
    mockCreatePlatformBlogPost.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      })
    );
    const { unmount } = render(<BlogEditorClient mode="create" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Upload inline image' })
    );
    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalled();
    });
    await act(async () => {});
    fireEvent.click(
      screen.getByRole('button', { name: 'Fill form with inline image' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit post' }));
    unmount();
    await act(async () => {});

    expect(mockDeleteBlogMediaUpload).not.toHaveBeenCalledWith(
      'platform/blog/inline.png',
      expect.anything()
    );
    await act(async () => {
      resolveSave({ id: 'new-post' });
    });
    expect(mockPush).toHaveBeenCalledWith('/admin/blog');
  });

  it('deletes abandoned uploads after a failed save', async () => {
    // A rejected save restores the previous snapshot, so teardown
    // deletes the failed draft's uploads instead of leaking them.
    mockCreatePlatformBlogPost.mockRejectedValueOnce(new Error('Save boom'));
    const { unmount } = render(<BlogEditorClient mode="create" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Upload inline image' })
    );
    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalled();
    });
    await act(async () => {});
    fireEvent.click(
      screen.getByRole('button', { name: 'Fill form with inline image' })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Submit post' }));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Save failed' })
      );
    });
    unmount();

    await waitFor(() => {
      expect(mockDeleteBlogMediaUpload).toHaveBeenCalledWith(
        'platform/blog/inline.png',
        []
      );
    });
  });
});
