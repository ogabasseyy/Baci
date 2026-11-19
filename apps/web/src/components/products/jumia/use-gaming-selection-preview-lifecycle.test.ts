import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
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
const category = {
  data: [{ id: 'gaming-category', name: 'Gaming' }],
  error: null,
};
const pageResponse = () =>
  Response.json({
    selectionId,
    total: 0,
    page: 1,
    totalPages: 0,
    legacyUnmappedCount: 0,
    products: [],
  });

describe('useGamingSelectionPreview lifecycle guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryRange.mockReset();
    mockCategoryRange.mockResolvedValue(category);
    localStorage.clear();
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json(
        { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' },
        { status: 201 }
      )
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('fences category discovery that resolves after the hook unmounts', async () => {
    let resolveCategories!: (result: typeof category) => void;
    mockCategoryRange
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveCategories = resolve))
      )
      .mockResolvedValue(category);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pageResponse()));
    const first = renderHook(() => useGamingSelectionPreview('merchant-1'));
    let firstRequest!: Promise<void>;
    act(() => {
      firstRequest = first.result.current.createPreview('create');
    });
    await waitFor(() => expect(mockCategoryRange).toHaveBeenCalledOnce());
    first.unmount();

    const reopened = renderHook(() => useGamingSelectionPreview('merchant-1'));
    await act(async () => reopened.result.current.createPreview('create'));
    expect(fetchWithCsrf).toHaveBeenCalledOnce();

    resolveCategories(category);
    await act(async () => firstRequest);
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
  });

  it('releases the creation lease before loading the first eligible page', async () => {
    let resolveFirstPage!: (response: Response) => void;
    const pageFetch = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Response>((resolve) => (resolveFirstPage = resolve))
      )
      .mockResolvedValue(pageResponse());
    vi.stubGlobal('fetch', pageFetch);
    const first = renderHook(() => useGamingSelectionPreview('merchant-1'));
    let creation!: Promise<void>;
    act(() => {
      creation = first.result.current.createPreview('create');
    });
    await waitFor(() => expect(pageFetch).toHaveBeenCalledOnce());

    const reopened = renderHook(() => useGamingSelectionPreview('merchant-1'));
    await act(async () => reopened.result.current.createPreview('create'));

    expect(reopened.result.current.snapshot?.selectionId).toBe(selectionId);
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
    resolveFirstPage(pageResponse());
    await act(async () => creation);
  });
});
