import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}));
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

describe('GamingSelectionPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates and pages a preview only, without presenting selection or submit controls', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              maybeSingle: async () => ({
                data: { id: 'gaming-category' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockImplementation(async (url) => {
      if (url.endsWith('/selections')) {
        return Response.json(
          { selectionId: 'selection-1', total: 51 },
          { status: 201 }
        );
      }
      throw new Error(`Unexpected write request: ${url}`);
    });
    let resolveSecondPage: (response: Response) => void = () => {};
    const pageFetch = vi.fn(async (url: string) => {
      const page = new URL(url, 'http://localhost').searchParams.get('page');
      if (page === '2') {
        return new Promise<Response>((resolve) => {
          resolveSecondPage = resolve;
        });
      }
      return Response.json({
        selectionId: 'selection-1',
        total: 51,
        page: Number(page),
        totalPages: 2,
        products:
          page === '1'
            ? [
                {
                  id: 'p1',
                  available: true,
                  unavailableReason: null,
                  product: { product: { name: 'Controller' } },
                },
              ]
            : [
                {
                  id: 'p2',
                  available: false,
                  unavailableReason: 'inactive',
                  product: null,
                },
              ],
      });
    });
    vi.stubGlobal('fetch', pageFetch);
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    const preview = screen.getByRole('region', {
      name: 'Gaming selection preview',
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );
    expect(await screen.findByText('Controller')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Loading products…'
    );
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    resolveSecondPage(
      Response.json({
        selectionId: 'selection-1',
        total: 51,
        page: 2,
        totalPages: 2,
        products: [
          {
            id: 'p2',
            available: false,
            unavailableReason: 'inactive',
            product: null,
          },
        ],
      })
    );
    expect(await screen.findByText('inactive')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(
      screen.getByText('51 products in this frozen selection')
    ).toBeInTheDocument();
    expect(preview.querySelector('[role="checkbox"]')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Submit products' })
    ).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/marketplace/jumia/products/selections',
      expect.objectContaining({ method: 'POST' })
    );
    expect(pageFetch).toHaveBeenCalledWith(
      expect.stringContaining('/eligible?selectionId=selection-1&page=2')
    );
  });

  it('shows an actionable safe error when selection creation fails', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              maybeSingle: async () => ({
                data: { id: 'gaming-category' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json({ error: 'sensitive database detail' }, { status: 500 })
    );
    render(<GamingSelectionPreview merchantId="merchant-1" />);

    fireEvent.click(
      screen.getByRole('button', { name: 'Create Gaming preview' })
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Unable to create a Gaming preview. Please retry.'
    );
    expect(
      screen.queryByText('sensitive database detail')
    ).not.toBeInTheDocument();
  });

  it('shows an empty state when the frozen selection contains no products', async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            ilike: () => ({
              maybeSingle: async () => ({
                data: { id: 'gaming-category' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json({ selectionId: 'selection-empty' }, { status: 201 })
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          selectionId: 'selection-empty',
          total: 0,
          page: 1,
          totalPages: 0,
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
});
