import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';
import { useGamingSelectionPreview } from './use-gaming-selection-preview';

const { mockCategoryRange } = vi.hoisted(() => ({
  mockCategoryRange: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({ order: () => ({ range: mockCategoryRange }) }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const merchantId = 'merchant-read-cancel';
const category = { id: 'gaming-category', name: 'Gaming' };
const selectionId = '00000000-0000-4000-8000-000000000031';

describe('Gaming preview eligible-read cancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockCategoryRange.mockResolvedValue({ data: [category], error: null });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('aborts a stalled cached read on unmount and releases the merchant lock', async () => {
    gamingSelectionPreviewCache.write(
      gamingSelectionPreviewCache.key(merchantId, category.id),
      { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' }
    );
    let lockTail = Promise.resolve();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: Lock) => Promise<unknown>
        ) => {
          const previous = lockTail;
          let release!: () => void;
          lockTail = new Promise<void>((resolve) => {
            release = resolve;
          });
          await previous;
          try {
            return await callback({
              name: 'gaming-preview',
              mode: 'exclusive',
            } as Lock);
          } finally {
            release();
          }
        },
      } as unknown as LockManager,
    });

    let firstReadSignal: AbortSignal | undefined;
    const pageFetch = vi
      .fn()
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            firstReadSignal = init?.signal as AbortSignal;
            firstReadSignal.addEventListener(
              'abort',
              () => reject(firstReadSignal?.reason),
              { once: true }
            );
          })
      )
      .mockResolvedValueOnce(
        Response.json({
          selectionId,
          total: 0,
          page: 1,
          totalPages: 1,
          legacyUnmappedCount: 0,
          products: [],
        })
      );
    vi.stubGlobal('fetch', pageFetch);

    const first = renderHook(() => useGamingSelectionPreview(merchantId));
    let firstCreation = Promise.resolve();
    act(() => {
      firstCreation = first.result.current.createPreview('create');
    });
    await waitFor(() => expect(pageFetch).toHaveBeenCalledOnce());

    first.unmount();
    await act(async () => firstCreation);

    expect(firstReadSignal?.aborted).toBe(true);
    expect(
      gamingSelectionPreviewCache.read(
        gamingSelectionPreviewCache.key(merchantId, category.id)
      )?.selectionId
    ).toBe(selectionId);
    expect(fetchWithCsrf).not.toHaveBeenCalled();

    const reopened = renderHook(() => useGamingSelectionPreview(merchantId));
    await act(async () => reopened.result.current.createPreview('create'));

    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(reopened.result.current.snapshot?.selectionId).toBe(selectionId);
    expect(fetchWithCsrf).not.toHaveBeenCalled();
    reopened.unmount();
  });
});
