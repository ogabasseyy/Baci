import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { GamingSelectionPreview } from './gaming-selection-preview';
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

const category = { id: 'gaming-category', name: 'Gaming' };
const selectionId = '00000000-0000-4000-8000-000000000026';

describe('Gaming preview creation admission races', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockCategoryRange.mockReset();
    mockCategoryRange.mockResolvedValue({ data: [category], error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('rechecks uncertainty under lock and exposes Retry while disabling Refresh', async () => {
    let resolveCategories!: (result: {
      data: (typeof category)[];
      error: null;
    }) => void;
    mockCategoryRange
      .mockResolvedValueOnce({ data: [category], error: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCategories = resolve;
          })
      );
    gamingSelectionPreviewCache.write(
      gamingSelectionPreviewCache.key('merchant-category-race', category.id),
      {
        selectionId,
        expiresAt: '2099-01-01T00:00:00.000Z',
      }
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          selectionId,
          total: 0,
          page: 1,
          totalPages: 1,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-category-race" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    await screen.findByText('0 products in this frozen selection');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    await waitFor(() => expect(mockCategoryRange).toHaveBeenCalledTimes(2));

    gamingSelectionPreviewCache.markUncertainCreation('merchant-category-race');
    resolveCategories({ data: [category], error: null });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Retry preview creation' })
      ).toBeInTheDocument()
    );

    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /may have created this preview/i
    );
    expect(
      screen.getByRole('button', { name: 'Retry preview creation' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Refresh preview' })
    ).toBeDisabled();
    expect(
      gamingSelectionPreviewCache.hasUncertainCreation('merchant-category-race')
    ).toBe(true);
  });

  it('does not POST for a merchant that changes while lock acquisition waits', async () => {
    let grantLock!: () => void;
    let lockRequestStarted = false;
    let lockReleased = false;
    const lockGrant = new Promise<Lock>((resolve) => {
      grantLock = () =>
        resolve({ name: 'gaming-preview', mode: 'exclusive' } as Lock);
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: Lock | null) => Promise<unknown>
        ) => {
          lockRequestStarted = true;
          try {
            return await callback(await lockGrant);
          } finally {
            lockReleased = true;
          }
        },
      } as unknown as LockManager,
    });
    const { result, rerender } = renderHook(
      ({ merchantId }) => useGamingSelectionPreview(merchantId),
      { initialProps: { merchantId: 'merchant-before-lock' } }
    );
    let creation = Promise.resolve();
    act(() => {
      creation = result.current.createPreview('create');
    });
    await waitFor(() => expect(lockRequestStarted).toBe(true));

    rerender({ merchantId: 'merchant-after-lock' });
    grantLock();
    await act(async () => creation);

    expect(fetchWithCsrf).not.toHaveBeenCalled();
    await waitFor(() => expect(lockReleased).toBe(true));
  });

  it('reuses the latest cached snapshot after a delayed lock grant', async () => {
    const latestSelectionId = '00000000-0000-4000-8000-000000000027';
    let grantLock!: () => void;
    let lockRequestStarted = false;
    const lockGrant = new Promise<Lock>((resolve) => {
      grantLock = () =>
        resolve({ name: 'gaming-preview', mode: 'exclusive' } as Lock);
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (
          _name: string,
          _options: unknown,
          callback: (lock: Lock | null) => Promise<unknown>
        ) => {
          lockRequestStarted = true;
          return callback(await lockGrant);
        },
      } as unknown as LockManager,
    });
    const pageFetch = vi.fn(async (input: RequestInfo | URL) => {
      const selection = new URL(
        String(input),
        'http://localhost'
      ).searchParams.get('selectionId');
      return Response.json({
        selectionId: selection,
        total: 0,
        page: 1,
        totalPages: 1,
        legacyUnmappedCount: 0,
        products: [],
      });
    });
    vi.stubGlobal('fetch', pageFetch);
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-cache-race')
    );
    let creation = Promise.resolve();
    act(() => {
      creation = result.current.createPreview('create');
    });
    await waitFor(() => expect(lockRequestStarted).toBe(true));
    gamingSelectionPreviewCache.write(
      gamingSelectionPreviewCache.key('merchant-cache-race', category.id),
      { selectionId: latestSelectionId, expiresAt: '2099-03-01T00:00:00.000Z' }
    );

    grantLock();
    await act(async () => creation);

    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(pageFetch).toHaveBeenCalledOnce();
    expect(result.current.snapshot?.selectionId).toBe(latestSelectionId);
  });

  it('does not POST a new snapshot when a durable lease cannot be written', async () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key.startsWith('jumia-gaming-preview-uncertain:')) {
        throw new Error('storage unavailable');
      }
      return originalSetItem.call(this, key, value);
    });
    const { result } = renderHook(() =>
      useGamingSelectionPreview('merchant-no-durable-lease')
    );

    await act(async () => result.current.createPreview('create'));

    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/cannot be created safely/i);
  });
});
