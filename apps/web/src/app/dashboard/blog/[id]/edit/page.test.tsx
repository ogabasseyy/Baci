import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EditBlogPostPage,
  existingPost,
  jsonResponse,
  mockAutoSave,
  mockBlogEditor,
  mockFeaturedImageUploader,
  mockFetch,
  mockFetchWithCsrf,
  mockToast,
  mockWindowOpen,
  resetEditBlogPageTestSupport,
} from './edit-blog-page.test-support';

describe('EditBlogPostPage Discover image upload metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
    resetEditBlogPageTestSupport();
    window.open = mockWindowOpen;
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue(jsonResponse(existingPost));
  });
  afterEach(vi.unstubAllEnvs);

  it('remounts the editor after recovering and undoing an edit draft', async () => {
    mockAutoSave.hasSavedData.mockReturnValue(true);
    mockAutoSave.getSavedData.mockReturnValue({
      data: { ...existingPost, content: 'Recovered draft content' },
    });
    render(<EditBlogPostPage />);

    await screen.findByRole('heading', { name: /edit post/i });
    expect(mockBlogEditor.contentResetKey).toBe(1);
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Draft Recovered' })
    );

    const recoveredToast = mockToast.mock.calls.find(
      ([options]) =>
        (options as { title?: string } | undefined)?.title === 'Draft Recovered'
    )?.[0] as { action: ReactNode };
    render(recoveredToast.action);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(mockBlogEditor.contentResetKey).toBe(2));
  });

  it('hydrates image metadata and persists it on save', async () => {
    const user = userEvent.setup();
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ ...existingPost, updated_at: '2026-05-03T00:00:00.000Z' })
    );
    render(<EditBlogPostPage />);
    await screen.findByRole('heading', { name: /edit post/i });
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/merchant/blog/posts/post-1?merchantId=merchant-1'
    );
    expect(screen.getByAltText('Featured image preview')).toHaveAttribute(
      'src',
      existingPost.featured_image_variants.landscape_16x9
    );
    await user.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1));
    expect(mockFetchWithCsrf.mock.calls[0]?.[0]).toBe(
      '/api/merchant/blog/posts/post-1?merchantId=merchant-1'
    );
    const payload = JSON.parse(
      (mockFetchWithCsrf.mock.calls[0]?.[1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(payload.featured_image_url).toBe(existingPost.featured_image_url);
    expect(payload.featured_image_width).toBe(1200);
    expect(payload.featured_image_height).toBe(675);
    expect(payload.featured_image_variants).toEqual(
      existingPost.featured_image_variants
    );
  });

  it('uploads editor images with purpose=inline', async () => {
    const user = userEvent.setup();
    mockFetchWithCsrf.mockResolvedValueOnce(
      jsonResponse({ url: 'https://cdn.example.com/inline.png' })
    );
    render(<EditBlogPostPage />);
    await screen.findByRole('heading', { name: /edit post/i });
    await user.click(
      screen.getByRole('button', { name: /upload inline image/i })
    );
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1));
    expect(
      (mockFetchWithCsrf.mock.calls[0]?.[1] as { body: FormData }).body.get(
        'purpose'
      )
    ).toBe('inline');
  });

  it('reports non-JSON featured image delete failures with status context', async () => {
    const user = userEvent.setup();
    mockFetchWithCsrf.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => '<html>bad gateway</html>',
    });
    render(<EditBlogPostPage />);
    await screen.findByRole('heading', { name: /edit post/i });
    await user.click(screen.getByRole('button', { name: /remove image/i }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Error',
          description: 'Failed to delete image (500): <html>bad gateway</html>',
          variant: 'destructive',
        })
      )
    );
  });

  it('deletes the previous session upload before tracking a replacement featured image', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      jsonResponse({
        ...existingPost,
        featured_image_url: '',
        featured_image_width: null,
        featured_image_height: null,
        featured_image_variants: {},
      })
    );
    mockFetchWithCsrf
      .mockResolvedValueOnce(
        jsonResponse({
          url: 'https://cdn.example.com/first.png',
          path: 'merchant-1/blog/first/original.png',
          width: 1200,
          height: 675,
          variants: {
            landscape_16x9: 'https://cdn.example.com/first-16x9.webp',
          },
          variantPaths: {
            landscape_16x9: 'merchant-1/blog/first/landscape_16x9.webp',
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          url: 'https://cdn.example.com/second.png',
          path: 'merchant-1/blog/second/original.png',
          width: 1200,
          height: 675,
          variants: {
            landscape_16x9: 'https://cdn.example.com/second-16x9.webp',
          },
          variantPaths: {
            landscape_16x9: 'merchant-1/blog/second/landscape_16x9.webp',
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse({ deleted: true }));
    render(<EditBlogPostPage />);
    await screen.findByRole('button', { name: /upload featured image/i });
    const uploadFeaturedImage = mockFeaturedImageUploader.onFilesSelected;
    expect(uploadFeaturedImage).toBeDefined();
    await uploadFeaturedImage?.([
      new File(['first'], 'first.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1));
    await uploadFeaturedImage?.([
      new File(['second'], 'second.png', { type: 'image/png' }),
    ]);
    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(3));
    const deleteCall = mockFetchWithCsrf.mock.calls.find(
      ([url, options]) =>
        url === '/api/merchant/blog/upload' &&
        (options as { method?: string })?.method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();
    expect(JSON.parse((deleteCall?.[1] as { body: string }).body)).toEqual({
      path: 'merchant-1/blog/first/original.png',
      variantPaths: {
        landscape_16x9: 'merchant-1/blog/first/landscape_16x9.webp',
      },
    });
  });

  it('preserves linked products when their edit-form hydration is incomplete', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          ...existingPost,
          embedded_products: [
            'd5bc84b7-35c2-4e09-a5e7-6ebdd0fd1145',
            '7c78af2f-75b8-4a30-9bb4-7abf51490fe9',
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ products: [] }));
    mockFetchWithCsrf.mockResolvedValueOnce(jsonResponse(existingPost));

    render(<EditBlogPostPage />);
    await screen.findByRole('heading', { name: /edit post/i });
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(
      (mockFetchWithCsrf.mock.calls[0]?.[1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(payload).not.toHaveProperty('embedded_products');
  });

  it('persists an explicit replacement after linked-product hydration fails', async () => {
    const user = userEvent.setup();
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse({
          ...existingPost,
          embedded_products: [
            'd5bc84b7-35c2-4e09-a5e7-6ebdd0fd1145',
            '7c78af2f-75b8-4a30-9bb4-7abf51490fe9',
          ],
        })
      )
      .mockResolvedValueOnce(jsonResponse({ products: [] }));
    mockFetchWithCsrf.mockResolvedValueOnce(jsonResponse(existingPost));

    render(<EditBlogPostPage />);
    await screen.findByRole('heading', { name: /edit post/i });
    await user.click(
      screen.getByRole('button', { name: /replace embedded products/i })
    );
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(mockFetchWithCsrf).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(
      (mockFetchWithCsrf.mock.calls[0]?.[1] as { body: string }).body
    ) as Record<string, unknown>;
    expect(payload.embedded_products).toEqual([
      'd5bc84b7-35c2-4e09-a5e7-6ebdd0fd1145',
    ]);
  });
});
