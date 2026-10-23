import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();
function setupGamingCategories() {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        eq: () => ({
          ilike: () => ({
            order: () => ({
              limit: async () => ({
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

describe('GamingSelectionPreview snapshot cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('reuses an unexpired frozen preview after the component is reopened', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockImplementation(async () =>
      Response.json(
        {
          selectionId: 'selection-cached',
          total: 0,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
    const pageFetch = vi.fn(async () =>
      Response.json({
        selectionId: 'selection-cached',
        total: 0,
        page: 1,
        totalPages: 0,
        legacyUnmappedCount: 0,
        products: [],
      })
    );
    vi.stubGlobal('fetch', pageFetch);

    const firstRender = render(
      <GamingSelectionPreview merchantId="merchant-1" />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(
      JSON.parse(
        localStorage.getItem(
          'jumia-gaming-preview:merchant-1:gaming-category'
        ) ?? 'null'
      )
    ).toMatchObject({
      selectionId: 'selection-cached',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    firstRender.unmount();

    render(<GamingSelectionPreview merchantId="merchant-1" />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(
      await screen.findByText('No products in this Gaming selection.')
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(pageFetch).toHaveBeenCalledTimes(2);
  });

  it('lets merchants refresh a cached preview to include catalog changes', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: 'selection-before-refresh',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            selectionId: 'selection-after-refresh',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
          { status: 201 }
        )
      );
    const pageFetch = vi.fn(async (url: string) => {
      const selectionId = new URL(url, 'http://localhost').searchParams.get(
        'selectionId'
      );
      return Response.json({
        selectionId,
        total: 0,
        page: 1,
        totalPages: 0,
        legacyUnmappedCount: 0,
        products: [],
      });
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

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(pageFetch).toHaveBeenCalledTimes(2));
    expect(pageFetch).toHaveBeenLastCalledWith(
      expect.stringContaining('selectionId=selection-after-refresh')
    );
    expect(
      JSON.parse(
        localStorage.getItem(
          'jumia-gaming-preview:merchant-1:gaming-category'
        ) ?? 'null'
      )
    ).toMatchObject({ selectionId: 'selection-after-refresh' });
  });
});
