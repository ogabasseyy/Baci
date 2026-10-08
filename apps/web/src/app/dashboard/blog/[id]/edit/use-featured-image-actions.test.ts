import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostFormData } from './edit-blog-types';
import { useFeaturedImageActions } from './use-featured-image-actions';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

const formData: PostFormData = {
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  featured_image_url: '',
  featured_image_alt: '',
  featured_image_width: null,
  featured_image_height: null,
  featured_image_variants: {},
  category: '',
  tags: '',
  keywords: '',
  author_name: '',
  author_title: '',
  author_bio: '',
  seo_title: '',
  seo_description: '',
  focus_keyword: '',
  status: 'draft',
  published_at: null,
};

function response(body: unknown) {
  return { ok: true, json: async () => body };
}

describe('useFeaturedImageActions merchant context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN', 'https://cdn.example.com');
  });
  afterEach(vi.unstubAllEnvs);

  it('sends the selected merchant context with inline image uploads', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      response({ url: 'https://cdn.example.com/inline.png' })
    );
    const { result } = renderHook(() =>
      useFeaturedImageActions({
        merchantId: 'merchant-selected',
        formData,
        setFormData: vi.fn(),
        toast: vi.fn(),
      })
    );

    await act(() =>
      result.current.handleInlineImageUpload(
        new File(['image'], 'inline.png', { type: 'image/png' })
      )
    );

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/merchant/blog/upload',
      expect.objectContaining({
        headers: { 'x-baci-merchant-id': 'merchant-selected' },
        method: 'POST',
      })
    );
  });

  it('sends the selected merchant context when deleting a persisted featured image', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(response({ success: true }));
    const { result } = renderHook(() =>
      useFeaturedImageActions({
        merchantId: 'merchant-selected',
        formData: {
          ...formData,
          featured_image_url:
            'https://cdn.example.com/media/merchant-selected/blog/featured.png',
        },
        setFormData: vi.fn(),
        toast: vi.fn(),
      })
    );

    await act(() => result.current.handleRemoveFeaturedImage());

    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/merchant/blog/upload',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-baci-merchant-id': 'merchant-selected',
        }),
        method: 'DELETE',
      })
    );
  });

  it('fails closed before an inline upload when no merchant is selected', async () => {
    const { result } = renderHook(() =>
      useFeaturedImageActions({
        merchantId: undefined,
        formData,
        setFormData: vi.fn(),
        toast: vi.fn(),
      })
    );

    await expect(
      result.current.handleInlineImageUpload(
        new File(['image'], 'inline.png', { type: 'image/png' })
      )
    ).rejects.toThrow('Select a merchant before uploading media');

    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
  });

  it('deletes and rejects an inline upload that completes after a merchant switch', async () => {
    const pendingUpload: {
      resolve?: (value: ReturnType<typeof response>) => void;
    } = {};
    mockFetchWithCsrf
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            pendingUpload.resolve = resolve as (
              value: ReturnType<typeof response>
            ) => void;
          })
      )
      .mockResolvedValueOnce(response({ deleted: true }));
    const { result, rerender } = renderHook(
      ({ merchantId }) =>
        useFeaturedImageActions({
          merchantId,
          formData,
          setFormData: vi.fn(),
          toast: vi.fn(),
        }),
      { initialProps: { merchantId: 'merchant-selected' } }
    );
    const upload = result.current.handleInlineImageUpload(
      new File(['image'], 'inline.png', { type: 'image/png' })
    );

    rerender({ merchantId: 'merchant-other' });
    if (!pendingUpload.resolve) throw new Error('Upload did not start');
    pendingUpload.resolve({
      ok: true,
      json: async () => ({
        path: 'merchant-selected/blog/inline.png',
        url: 'https://cdn.example.com/inline.png',
      }),
    });

    await expect(upload).rejects.toThrow(
      'Merchant changed while uploading media'
    );
    expect(mockFetchWithCsrf).toHaveBeenLastCalledWith(
      '/api/merchant/blog/upload',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-baci-merchant-id': 'merchant-selected',
        }),
        method: 'DELETE',
      })
    );
  });

  it('keeps the latest featured upload active and cleans a superseded upload for the same merchant', async () => {
    const firstUpload: {
      resolve?: (value: ReturnType<typeof response>) => void;
    } = {};
    const secondUpload: {
      resolve?: (value: ReturnType<typeof response>) => void;
    } = {};
    const setFormData = vi.fn();
    mockFetchWithCsrf
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            firstUpload.resolve = resolve as (
              value: ReturnType<typeof response>
            ) => void;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            secondUpload.resolve = resolve as (
              value: ReturnType<typeof response>
            ) => void;
          })
      )
      .mockResolvedValueOnce(response({ deleted: true }));
    const { result } = renderHook(() =>
      useFeaturedImageActions({
        merchantId: 'merchant-selected',
        formData,
        setFormData,
        toast: vi.fn(),
      })
    );

    let first: Promise<void>;
    let second: Promise<void>;
    act(() => {
      first = result.current.handleFeaturedImageUpload([
        new File(['first'], 'first.png', { type: 'image/png' }),
      ]);
      second = result.current.handleFeaturedImageUpload([
        new File(['second'], 'second.png', { type: 'image/png' }),
      ]);
    });

    if (!firstUpload.resolve || !secondUpload.resolve)
      throw new Error('Uploads did not start');
    firstUpload.resolve(
      response({
        path: 'merchant-selected/blog/first.png',
        url: 'https://cdn.example.com/first.png',
        width: 100,
        height: 100,
      })
    );
    await act(async () => first);

    expect(result.current.isUploading).toBe(true);
    expect(setFormData).not.toHaveBeenCalled();
    expect(mockFetchWithCsrf).toHaveBeenLastCalledWith(
      '/api/merchant/blog/upload',
      expect.objectContaining({
        body: expect.stringContaining('merchant-selected/blog/first.png'),
        headers: expect.objectContaining({
          'x-baci-merchant-id': 'merchant-selected',
        }),
        method: 'DELETE',
      })
    );

    secondUpload.resolve(
      response({
        path: 'merchant-selected/blog/second.png',
        url: 'https://cdn.example.com/second.png',
        width: 100,
        height: 100,
        variants: {
          landscape_16x9: 'https://cdn.example.com/second-16x9.webp',
          unsupported: 'https://cdn.example.com/unsupported.webp',
        },
      })
    );
    await act(async () => second);

    expect(result.current.isUploading).toBe(false);
    expect(setFormData).toHaveBeenCalledTimes(1);
    const updateFormData = setFormData.mock.calls[0]?.[0] as (
      previous: PostFormData
    ) => PostFormData;
    expect(updateFormData(formData)).toEqual(
      expect.objectContaining({
        featured_image_height: 100,
        featured_image_url: 'https://cdn.example.com/second.png',
        featured_image_variants: {
          landscape_16x9: 'https://cdn.example.com/second-16x9.webp',
        },
        featured_image_width: 100,
      })
    );
  });
});
