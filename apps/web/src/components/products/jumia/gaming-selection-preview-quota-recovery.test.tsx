import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { GamingSelectionPreview } from './gaming-selection-preview';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

const merchantId = 'merchant-quota-recovery';
const selectionId = '00000000-0000-4000-8000-000000000091';
const mockFrom = vi.fn();

function setupGamingCategory() {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              range: async () => ({
                data: [{ id: 'gaming-category', name: 'Gaming' }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    }),
  });
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

describe('Gaming preview recovery after cache quota failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    gamingSelectionPreviewCache.remove(
      gamingSelectionPreviewCache.key(merchantId, 'gaming-category')
    );
    gamingSelectionPreviewCache.clearKnownSuccessfulSelection(merchantId);
    gamingSelectionPreviewCache.clearUncertainCreation(merchantId);
    setupGamingCategory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    false,
    true,
  ])('reopens acknowledged success when the cache and pending writes fail=%s', async (pendingWriteFails) => {
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(
      Response.json(
        {
          selectionId,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    const pageFetch = vi.fn().mockImplementation((url: string) => {
      const requestedSelection = new URL(
        String(url),
        'http://localhost'
      ).searchParams.get('selectionId');
      return Promise.resolve(
        Response.json({
          selectionId: requestedSelection,
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      );
    });
    vi.stubGlobal('fetch', pageFetch);
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key,
      value
    ) {
      if (
        key.startsWith(`jumia-gaming-preview:${merchantId}:`) ||
        (pendingWriteFails &&
          key === `jumia-gaming-preview-uncertain:${merchantId}` &&
          value === 'pending')
      ) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      }
      originalSetItem.call(this, key, value);
    });

    const firstMount = render(
      <GamingSelectionPreview merchantId={merchantId} />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledOnce();
    expect(gamingSelectionPreviewCache.hasUncertainCreation(merchantId)).toBe(
      true
    );

    firstMount.unmount();
    render(<GamingSelectionPreview merchantId={merchantId} />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Retry preview creation' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();

    expect(fetchWithCsrf).toHaveBeenCalledOnce();
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(pageFetch.mock.calls[1][0]).toContain(selectionId);
    expect(gamingSelectionPreviewCache.hasUncertainCreation(merchantId)).toBe(
      true
    );
  });
});
