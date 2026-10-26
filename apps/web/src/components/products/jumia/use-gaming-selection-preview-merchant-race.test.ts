import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
            ilike: () => ({
              order: () => ({ range: mockCategoryRange }),
            }),
          }),
        }),
      }),
    }),
  }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

const selectionId = '00000000-0000-4000-8000-000000000026';

describe('useGamingSelectionPreview merchant race', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryRange.mockReset();
    mockCategoryRange.mockResolvedValue({ data: [], error: null });
    localStorage.clear();
    gamingSelectionPreviewCache.clearUncertainCreation('merchant-a');
  });

  it('clears and fences a prior merchant preview when the merchant changes', async () => {
    mockCategoryRange.mockResolvedValue({
      data: [{ id: 'category-a', name: 'Gaming' }],
      error: null,
    });
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json(
        { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' },
        { status: 201 }
      )
    );
    let resolvePageTwo: (response: Response) => void = () => {};
    let pageTwoCalls = 0;
    const pageFetch = vi.fn((input: RequestInfo | URL) => {
      const page = Number(
        new URL(String(input), 'http://localhost').searchParams.get('page')
      );
      if (page === 2) {
        pageTwoCalls += 1;
        if (pageTwoCalls === 1) {
          return Promise.resolve(new Response(null, { status: 500 }));
        }
        return new Promise<Response>((resolve) => {
          resolvePageTwo = resolve;
        });
      }
      return Promise.resolve(
        Response.json({
          selectionId,
          total: 2,
          page,
          totalPages: 2,
          legacyUnmappedCount: 0,
          products: [],
        })
      );
    });
    vi.stubGlobal('fetch', pageFetch);
    const { result, rerender } = renderHook(
      ({ merchantId }) => useGamingSelectionPreview(merchantId),
      { initialProps: { merchantId: 'merchant-a' } }
    );

    await act(async () => result.current.createPreview('create'));
    expect(result.current.snapshot?.selectionId).toBe(selectionId);
    await act(async () => result.current.goToPage(2));
    expect(result.current.error).toBeTruthy();
    expect(result.current.snapshot?.page).toBe(1);
    let pendingPage = Promise.resolve();
    act(() => {
      pendingPage = result.current.goToPage(2);
    });
    await waitFor(() => expect(pageFetch).toHaveBeenCalledTimes(3));

    rerender({ merchantId: 'merchant-b' });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    rerender({ merchantId: 'merchant-a' });
    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeNull();
    resolvePageTwo(
      Response.json({
        selectionId,
        total: 2,
        page: 2,
        totalPages: 2,
        legacyUnmappedCount: 0,
        products: [],
      })
    );
    await act(async () => pendingPage);

    expect(result.current.snapshot).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
