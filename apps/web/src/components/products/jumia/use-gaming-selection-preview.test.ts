import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
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
    gamingSelectionPreviewCache.clearUncertainCreation('merchant-1');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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

  it('renders the initial uncertainty state consistently without reading storage', async () => {
    gamingSelectionPreviewCache.markUncertainCreation('merchant-1');
    function Probe() {
      const { creationOutcomeUnknown } =
        useGamingSelectionPreview('merchant-1');
      return createElement('span', null, String(creationOutcomeUnknown));
    }

    expect(renderToString(createElement(Probe))).toContain('false');
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-1')
    );
    await waitFor(() => {
      expect(result.current.creationOutcomeUnknown).toBe(true);
    });
  });

  it('blocks a reopened dialog from posting while creation is still in flight', async () => {
    mockCategoryRange.mockResolvedValue({
      data: [{ id: 'gaming-category', name: 'Gaming' }],
      error: null,
    });
    let resolvePost!: (response: Response) => void;
    vi.mocked(fetchWithCsrf).mockReturnValue(
      new Promise((resolve) => {
        resolvePost = resolve;
      })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          selectionId,
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );

    const first = renderHook(() => useGamingSelectionPreview('merchant-1'));
    let firstCreation!: Promise<void>;
    act(() => {
      firstCreation = first.result.current.createPreview('create');
    });
    await waitFor(() => expect(fetchWithCsrf).toHaveBeenCalledOnce());
    expect(gamingSelectionPreviewCache.hasCreationInFlight('merchant-1')).toBe(
      true
    );
    first.unmount();

    const reopened = renderHook(() => useGamingSelectionPreview('merchant-1'));
    await act(async () => reopened.result.current.createPreview('create'));

    expect(fetchWithCsrf).toHaveBeenCalledOnce();
    expect(reopened.result.current.error).toMatch(/already being created/i);
    resolvePost(
      Response.json(
        { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' },
        { status: 201 }
      )
    );
    await act(async () => firstCreation);
    expect(gamingSelectionPreviewCache.hasCreationInFlight('merchant-1')).toBe(
      false
    );
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

  it('reuses a created selection after remount when local storage is unavailable', async () => {
    const merchantId = 'merchant-memory-only';
    mockCategoryRange.mockResolvedValue({
      data: [{ id: 'category-memory-only', name: 'Gaming' }],
      error: null,
    });
    vi.mocked(fetchWithCsrf).mockResolvedValue(
      Response.json(
        { selectionId, expiresAt: '2099-01-01T00:00:00.000Z' },
        { status: 201 }
      )
    );
    const pageFetch = vi.fn().mockImplementation(() =>
      Response.json({
        selectionId,
        total: 0,
        page: 1,
        totalPages: 0,
        legacyUnmappedCount: 0,
        products: [],
      })
    );
    vi.stubGlobal('fetch', pageFetch);
    const originalSetItem = Storage.prototype.setItem;
    const originalGetItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key.startsWith('jumia-gaming-preview:')) {
        throw new Error('storage disabled');
      }
      return originalSetItem.call(this, key, value);
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (
      this: Storage,
      key: string
    ) {
      if (key.startsWith('jumia-gaming-preview:')) {
        throw new Error('storage disabled');
      }
      return originalGetItem.call(this, key);
    });
    vi.spyOn(Storage.prototype, 'length', 'get').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const first = renderHook(() => useGamingSelectionPreview(merchantId));

    await act(async () => first.result.current.createPreview('create'));
    expect(first.result.current.snapshot?.selectionId).toBe(selectionId);
    first.unmount();
    const reopened = renderHook(() => useGamingSelectionPreview(merchantId));

    await act(async () => reopened.result.current.createPreview('create'));

    expect(reopened.result.current.snapshot?.selectionId).toBe(selectionId);
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
    expect(pageFetch).toHaveBeenCalledTimes(2);
  });

  it('reuses the cached preview after another tab clears the mounted retry state', async () => {
    const merchantId = 'merchant-mounted-cross-tab';
    const selectionKey = gamingSelectionPreviewCache.key(
      merchantId,
      'gaming-category'
    );
    const uncertaintyKey = `jumia-gaming-preview-uncertain:${merchantId}`;
    mockCategoryRange.mockResolvedValue({ data: [], error: null });
    gamingSelectionPreviewCache.markUncertainCreation(merchantId);
    gamingSelectionPreviewCache.write(selectionKey, {
      selectionId,
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          selectionId,
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );
    const { result } = renderHook(() => useGamingSelectionPreview(merchantId));

    await waitFor(() =>
      expect(result.current.creationOutcomeUnknown).toBe(true)
    );
    act(() => {
      localStorage.removeItem(uncertaintyKey);
      window.dispatchEvent(
        new StorageEvent('storage', { key: uncertaintyKey, newValue: null })
      );
    });
    await waitFor(() =>
      expect(result.current.creationOutcomeUnknown).toBe(false)
    );
    await act(async () => result.current.createPreview('create'));

    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(result.current.snapshot?.selectionId).toBe(selectionId);
  });
});
