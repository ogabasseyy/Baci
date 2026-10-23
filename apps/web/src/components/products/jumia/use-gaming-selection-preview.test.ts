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

describe('useGamingSelectionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCategoryRange.mockReset();
    mockCategoryRange.mockResolvedValue({ data: [], error: null });
    localStorage.clear();
  });

  it('restores an uncertain creation guard and blocks an unacknowledged create', async () => {
    gamingSelectionPreviewCache.markUncertainCreation('merchant-1');
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-1')
    );

    await waitFor(() => {
      expect(result.current.creationOutcomeUnknown).toBe(true);
    });
    await act(() => result.current.createPreview('create'));

    expect(result.current.error).toMatch(/may have created this preview/i);
    expect(fetchWithCsrf).not.toHaveBeenCalled();
  });

  it('discovers Gaming beyond the first category page and completes pagination', async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      id: `category-${index}`,
      name: 'Gaming accessories',
    }));
    mockCategoryRange.mockImplementation(async (start: number) => ({
      data:
        start === 0 ? firstPage : [{ id: 'canonical-gaming', name: 'Gaming' }],
      error: null,
    }));
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json(
        { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' },
        { status: 201 }
      )
    );
    const pageFetch = vi.fn(async (input: RequestInfo | URL) => {
      const page = Number(
        new URL(String(input), 'http://localhost').searchParams.get('page')
      );
      return Response.json({
        selectionId,
        total: 2,
        page,
        totalPages: 2,
        legacyUnmappedCount: 0,
        products: [],
      });
    });
    vi.stubGlobal('fetch', pageFetch);
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-1')
    );

    await act(async () => result.current.createPreview('create'));

    expect(mockCategoryRange.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
    expect(result.current.snapshot?.page).toBe(1);
    expect(
      gamingSelectionPreviewCache.read(
        gamingSelectionPreviewCache.key('merchant-1', 'canonical-gaming')
      )
    ).toEqual({
      selectionId,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await act(async () => result.current.goToPage(2));

    expect(result.current.snapshot?.page).toBe(2);
    expect(pageFetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing', {}],
    ['invalid', { expiresAt: 'not-a-date' }],
    ['expired', { expiresAt: '2000-01-01T00:00:00.000Z' }],
  ])('retains uncertain-creation state when the expiry is %s', async (_, expiry) => {
    mockCategoryRange.mockResolvedValue({
      data: [{ id: 'canonical-gaming', name: 'Gaming' }],
      error: null,
    });
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json({ selectionId, ...expiry }, { status: 201 })
    );
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-1')
    );

    await act(async () => result.current.createPreview('create'));

    expect(result.current.creationOutcomeUnknown).toBe(true);
    expect(result.current.error).toMatch(/may have created this preview/i);
    expect(gamingSelectionPreviewCache.hasUncertainCreation('merchant-1')).toBe(
      true
    );
    expect(
      gamingSelectionPreviewCache.read(
        gamingSelectionPreviewCache.key('merchant-1', 'canonical-gaming')
      )
    ).toBeNull();
  });
});
