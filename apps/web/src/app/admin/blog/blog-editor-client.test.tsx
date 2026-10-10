import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BlogEditorClient } from './blog-editor-client';
import type { PlatformAdminBlogPostDetail } from './blog-types';

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
            content: 'Article body',
            title: 'Launch Faster',
          }))
        }
      >
        Fill valid form
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

const editPost: PlatformAdminBlogPostDetail = {
  author_name: 'Baci Editorial',
  category: 'Growth',
  content: 'Existing content',
  excerpt: '',
  featured_image_alt: '',
  featured_image_height: 675,
  featured_image_url: '',
  featured_image_variants: {},
  featured_image_width: 1200,
  id: 'post-1',
  published_at: null,
  seo_description: '',
  seo_title: '',
  slug: 'launch-faster',
  status: 'draft',
  tags: ['growth'],
  title: 'Launch Faster',
  updated_at: null,
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

describe('BlogEditorClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreatePlatformBlogPost.mockResolvedValue({ id: 'new-post' });
    mockUpdatePlatformBlogPost.mockResolvedValue({ id: 'post-1' });
    mockFetchWithCsrf.mockResolvedValue(
      jsonResponse({ url: 'https://cdn.example.com/inline.png' })
    );
  });

  it('renders not-found state for edit mode when initial post is missing', () => {
    render(<BlogEditorClient mode="edit" postId="post-1" initialPost={null} />);

    expect(screen.getByText('Post not found.')).toBeInTheDocument();
  });

  it('creates a post in create mode and navigates back to list', async () => {
    render(<BlogEditorClient mode="create" />);

    fireEvent.click(screen.getByRole('button', { name: 'Fill valid form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit post' }));

    await waitFor(() => {
      expect(mockCreatePlatformBlogPost).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'Article body',
          slug: 'launch-faster',
          title: 'Launch Faster',
        })
      );
    });
    expect(mockPush).toHaveBeenCalledWith('/admin/blog');
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Post created' })
    );
  });

  it('updates a post in edit mode', async () => {
    render(
      <BlogEditorClient mode="edit" postId="post-1" initialPost={editPost} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fill valid form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit post' }));

    await waitFor(() => {
      expect(mockUpdatePlatformBlogPost).toHaveBeenCalledWith(
        'post-1',
        expect.objectContaining({
          content: 'Article body',
          slug: 'launch-faster',
          title: 'Launch Faster',
        }),
        expect.objectContaining({
          id: 'post-1',
          slug: 'launch-faster',
          title: 'Launch Faster',
        })
      );
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Post updated' })
    );
  });

  it('fails fast in edit mode when postId is missing', async () => {
    render(<BlogEditorClient mode="edit" initialPost={editPost} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fill valid form' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit post' }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Save failed',
          description: 'Missing post id for edit mode',
          variant: 'destructive',
        })
      );
    });
    expect(mockUpdatePlatformBlogPost).not.toHaveBeenCalled();
    expect(mockCreatePlatformBlogPost).not.toHaveBeenCalled();
  });

  it('uploads inline images through the upload route helper', async () => {
    render(<BlogEditorClient mode="create" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Upload inline image' })
    );

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        '/api/admin/blog/upload',
        expect.objectContaining({
          body: expect.any(FormData),
          method: 'POST',
        })
      );
    });
  });
});
