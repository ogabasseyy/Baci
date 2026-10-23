import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GamingSelectionPreview } from './gaming-selection-preview';
import { gamingSelectionPreviewCache } from './gaming-selection-preview-cache';

const mockFrom = vi.fn();
function setupGamingCategories(
  categories = [{ id: 'gaming-category', name: 'Gaming' }]
) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              range: async () => ({ data: categories, error: null }),
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
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

describe('GamingSelectionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    gamingSelectionPreviewCache.clearUncertainCreation('merchant-1');
  });

  it('requires explicit retry after an ambiguous creation failure', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json({ error: 'sensitive database detail' }, { status: 500 })
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server may have created this preview, but the response could not be read.'
    );
    expect(
      screen.getByRole('button', { name: 'Retry preview creation' })
    ).toBeInTheDocument();
    expect(
      screen.queryByText('sensitive database detail')
    ).not.toBeInTheDocument();
  });

  it('explains that duplicate active Gaming categories must be resolved', async () => {
    setupGamingCategories([
      { id: 'gaming-category-a', name: 'Gaming' },
      { id: 'gaming-category-b', name: 'gaming ' },
    ]);
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'More than one active category is named Gaming.'
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('matches the server Gaming rule when the category name has surrounding whitespace', async () => {
    setupGamingCategories([{ id: 'gaming-category', name: ' Gaming ' }]);
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000021',
          total: 0,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000021',
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/marketplace/jumia/products/selections',
      expect.objectContaining({
        body: JSON.stringify({
          sourceCategoryId: 'gaming-category',
          merchantId: 'merchant-1',
        }),
      })
    );
  });

  it('shows the upgrade requirement for a marketplace entitlement response', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        { code: 'requires_upgrade', error: 'private upgrade details' },
        { status: 402 }
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Marketplace sync requires an upgraded plan.'
    );
    expect(
      screen.queryByText('private upgrade details')
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when the frozen selection contains no products', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000022',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000022',
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
  });

  it('shows a safe error when the eligible page violates its response schema', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000023',
          total: 1,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000023',
          total: 1,
          page: 1,
          totalPages: 1,
          legacyUnmappedCount: 0,
          products: [{ id: 'p1', available: 'yes' }],
        })
      )
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to read the Gaming preview. Please create it again.'
    );
  });
});
