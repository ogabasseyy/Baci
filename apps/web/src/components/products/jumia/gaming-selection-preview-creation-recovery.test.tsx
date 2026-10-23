import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();

function setupGamingCategories(
  categories: Array<{ id: string; name: string }>
) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              limit: async () => ({ data: categories, error: null }),
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

describe('GamingSelectionPreview creation recovery', () => {
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

  it('requires explicit retry after successful creation returns an unreadable response', async () => {
    setupGamingCategories([{ id: 'gaming-category', name: 'Gaming' }]);
    vi.mocked(fetchWithCsrf)
      .mockResolvedValueOnce(new Response('truncated', { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: '00000000-0000-4000-8000-000000000015',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000015',
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server may have created this preview, but the response could not be read. Use “Retry preview creation” only if you accept that it may create another snapshot.'
    );
    expect(fetchWithCsrf).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry preview creation' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
  });
});
