import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();
function setupGamingCategories(
  categories: Array<{ id: string; name: string }> = [
    { id: 'gaming-category', name: 'Gaming' },
  ]
) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              limit: async () => ({
                data: categories,
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

describe('GamingSelectionPreview cached-selection recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('replaces a server-rejected cached selection', async () => {
    setupGamingCategories();
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:gaming-category',
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000005',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000006',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    const pageFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'selection expired' }, { status: 410 })
      )
      .mockResolvedValueOnce(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000006',
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
    expect(fetcher).toHaveBeenCalledOnce();
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        localStorage.getItem(
          'jumia-gaming-preview:merchant-1:gaming-category'
        ) ?? 'null'
      )
    ).toMatchObject({ selectionId: '00000000-0000-4000-8000-000000000006' });
  });

  it('replaces a cached selection when its page fails schema validation', async () => {
    setupGamingCategories();
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:gaming-category',
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000007',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000008',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    const pageFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ selectionId: 'malformed' }))
      .mockResolvedValueOnce(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000008',
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
    expect(fetcher).toHaveBeenCalledOnce();
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        localStorage.getItem(
          'jumia-gaming-preview:merchant-1:gaming-category'
        ) ?? 'null'
      )
    ).toMatchObject({ selectionId: '00000000-0000-4000-8000-000000000008' });
  });

  it('invalidates a cached selection when its successful page is not JSON', async () => {
    setupGamingCategories();
    localStorage.setItem(
      'jumia-gaming-preview:merchant-1:gaming-category',
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000011',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: '00000000-0000-4000-8000-000000000012',
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    const pageFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('not-json', { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000012',
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
    expect(fetcher).toHaveBeenCalledOnce();
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(
        localStorage.getItem(
          'jumia-gaming-preview:merchant-1:gaming-category'
        ) ?? 'null'
      )
    ).toMatchObject({ selectionId: '00000000-0000-4000-8000-000000000012' });
  });

  it('continues to an older cached selection when the newest is rejected without a category', async () => {
    setupGamingCategories([]);
    const olderKey = 'jumia-gaming-preview:merchant-1:older-category';
    const newerKey = 'jumia-gaming-preview:merchant-1:newer-category';
    localStorage.setItem(
      olderKey,
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000009',
        expiresAt: '2099-01-01T00:00:00.000Z',
      })
    );
    localStorage.setItem(
      newerKey,
      JSON.stringify({
        selectionId: '00000000-0000-4000-8000-000000000010',
        expiresAt: '2099-02-01T00:00:00.000Z',
      })
    );
    const pageFetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: 'selection expired' }, { status: 410 })
      )
      .mockResolvedValueOnce(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000009',
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
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(pageFetch.mock.calls[0][0]).toContain(
      '00000000-0000-4000-8000-000000000010'
    );
    expect(pageFetch.mock.calls[1][0]).toContain(
      '00000000-0000-4000-8000-000000000009'
    );
    expect(localStorage.getItem(newerKey)).toBeNull();
    expect(localStorage.getItem(olderKey)).not.toBeNull();
  });
});
