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

  it('requires explicit retry when the creation request rejects after submission', async () => {
    setupGamingCategories([{ id: 'gaming-category', name: 'Gaming' }]);
    vi.mocked(fetchWithCsrf)
      .mockRejectedValueOnce(new TypeError('connection reset'))
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: '00000000-0000-4000-8000-000000000026',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      );
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          selectionId: '00000000-0000-4000-8000-000000000026',
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
      'The server may have created this preview'
    );
    expect(
      screen.getByRole('button', { name: 'Retry preview creation' })
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry preview creation' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
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

  it('does not reuse an old snapshot when explicitly retrying an unreadable refresh', async () => {
    setupGamingCategories([{ id: 'gaming-category', name: 'Gaming' }]);
    vi.mocked(fetchWithCsrf)
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: '00000000-0000-4000-8000-000000000017',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(new Response('', { status: 201 }))
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: '00000000-0000-4000-8000-000000000018',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      );
    const pageFetch = vi.fn().mockImplementation((url: string) => {
      const selectionId = new URL(
        String(url),
        'http://localhost'
      ).searchParams.get('selectionId');
      return Promise.resolve(
        Response.json({
          selectionId,
          total: 0,
          page: 1,
          totalPages: 0,
          legacyUnmappedCount: 0,
          products: [],
        })
      );
    });
    vi.stubGlobal('fetch', pageFetch);
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server may have created this preview'
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry preview creation' })
    );
    await screen.findByText('No products in this Gaming selection.');
    expect(fetchWithCsrf).toHaveBeenCalledTimes(3);
    expect(pageFetch).toHaveBeenCalledTimes(2);
    expect(pageFetch.mock.calls[1][0]).toContain(
      '00000000-0000-4000-8000-000000000018'
    );
  });

  it('treats a non-UUID returned selection ID as an uncertain creation result', async () => {
    setupGamingCategories([{ id: 'gaming-category', name: 'Gaming' }]);
    vi.mocked(fetchWithCsrf)
      .mockResolvedValueOnce(
        Response.json(
          { selectionId: 'not-a-uuid', expiresAt: '2099-01-01T00:00:00.000Z' },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: '00000000-0000-4000-8000-000000000019',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      );
    const pageFetch = vi.fn().mockResolvedValue(
      Response.json({
        selectionId: '00000000-0000-4000-8000-000000000019',
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
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The server may have created this preview'
    );
    expect(
      screen.getByRole('button', { name: 'Retry preview creation' })
    ).toBeInTheDocument();
    expect(pageFetch).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Retry preview creation' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
  });
});
