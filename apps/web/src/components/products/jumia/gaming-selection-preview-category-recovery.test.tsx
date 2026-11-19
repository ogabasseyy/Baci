import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();

function setupGamingCategories(
  categories: Array<{ id: string; name: string }>,
  error: { message: string } | null = null
) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              range: async () => ({ data: categories, error }),
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

describe('GamingSelectionPreview category recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('loads a matching cached preview before rejecting duplicate Gaming categories, but rejects refresh', async () => {
    setupGamingCategories([
      { id: 'gaming-category-a', name: 'Gaming' },
      { id: 'gaming-category-b', name: 'Gaming' },
    ]);
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:gaming-category-a',
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000014',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    const pageFetch = vi.fn().mockResolvedValue(
      Response.json({
        selectionId: '00000000-0000-4000-8000-000000000014',
        total: 0,
        page: 1,
        totalPages: 0,
        legacyUnmappedCount: 0,
        products: [],
      })
    );
    vi.stubGlobal('fetch', pageFetch);
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(pageFetch).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'More than one active category is named Gaming. Keep one active Gaming category before creating a preview.'
    );
    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(pageFetch).toHaveBeenCalledOnce();
  });

  it('tries the cached preview if category lookup fails for a normal create action', async () => {
    setupGamingCategories([], { message: 'temporary category read failure' });
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:cached-category',
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000016',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    const pageFetch = vi.fn().mockResolvedValue(
      Response.json({
        selectionId: '00000000-0000-4000-8000-000000000016',
        total: 0,
        page: 1,
        totalPages: 0,
        legacyUnmappedCount: 0,
        products: [],
      })
    );
    vi.stubGlobal('fetch', pageFetch);
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).not.toHaveBeenCalled();
    expect(pageFetch).toHaveBeenCalledOnce();
  });
});
