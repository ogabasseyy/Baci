// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNewBlogPostMediaActions } from './use-new-blog-post-media-actions';

const { mockFetchWithCsrf, mockMerchant } = vi.hoisted(() => ({
  mockFetchWithCsrf: vi.fn(),
  mockMerchant: { id: 'merchant-selected' },
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: mockMerchant }),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

const image = {
  path: 'merchant-selected/blog/featured.png',
  variantPaths: {
    landscape_16x9: 'merchant-selected/blog/featured/landscape_16x9.webp',
  },
};

function response(body: unknown) {
  return { ok: true, json: async () => body };
}

function renderMediaActions() {
  return renderHook(() =>
    useNewBlogPostMediaActions({
      uploadedFeaturedImage: null,
      setFormData: vi.fn(),
      setUploadedFeaturedImage: vi.fn(),
      toast: vi.fn(),
    })
  );
}

describe('useNewBlogPostMediaActions merchant context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMerchant.id = 'merchant-selected';
  });

  it('sends the selected merchant context with inline media uploads', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(
      response({ url: 'https://cdn.example.com/inline.png' })
    );
    const { result } = renderMediaActions();

    await act(() =>
      result.current.handleImageUpload(
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

  it('sends the selected merchant context when deleting an uploaded featured image', async () => {
    mockFetchWithCsrf.mockResolvedValueOnce(response({ success: true }));
    const { result } = renderHook(() =>
      useNewBlogPostMediaActions({
        uploadedFeaturedImage: image,
        setFormData: vi.fn(),
        setUploadedFeaturedImage: vi.fn(),
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
    mockMerchant.id = undefined as unknown as string;
    const { result } = renderMediaActions();

    await expect(
      result.current.handleImageUpload(
        new File(['image'], 'inline.png', { type: 'image/png' })
      )
    ).rejects.toThrow('Select a merchant before uploading media');

    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
  });

  it('shows a merchant-specific error before a featured upload without a merchant', async () => {
    mockMerchant.id = undefined as unknown as string;
    const toast = vi.fn();
    const { result } = renderHook(() =>
      useNewBlogPostMediaActions({
        uploadedFeaturedImage: null,
        setFormData: vi.fn(),
        setUploadedFeaturedImage: vi.fn(),
        toast,
      })
    );

    await act(() =>
      result.current.handleFeaturedImageUpload([
        new File(['image'], 'featured.png', { type: 'image/png' }),
      ])
    );

    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith({
      description: 'Select a merchant before uploading media',
      title: 'Merchant unavailable',
      variant: 'destructive',
    });
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
    const { result, rerender } = renderMediaActions();
    const upload = result.current.handleImageUpload(
      new File(['image'], 'inline.png', { type: 'image/png' })
    );

    mockMerchant.id = 'merchant-other';
    rerender();
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
      useNewBlogPostMediaActions({
        uploadedFeaturedImage: null,
        setFormData,
        setUploadedFeaturedImage: vi.fn(),
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
      })
    );
    await act(async () => second);

    expect(result.current.isUploading).toBe(false);
    expect(setFormData).toHaveBeenCalledTimes(1);
  });
});
