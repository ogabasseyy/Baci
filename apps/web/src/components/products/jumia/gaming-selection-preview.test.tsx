import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GamingSelectionPreview } from './gaming-selection-preview';

const mockFrom = vi.fn();
function setupGamingCategories(categories = [{ id: 'gaming-category' }]) {
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
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn(),
}));

describe('GamingSelectionPreview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates and pages a preview only, without presenting selection or submit controls', async () => {
    setupGamingCategories();
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
        legacyUnmappedCount: 3,
        products:
          page === '1'
            ? [
                {
                  id: 'p1',
                  available: true,
                  unavailableReason: null,
                  capturedSourceVersion: 'captured-version',
                  currentSourceVersion: 'current-version',
                  product: { product: { name: 'Controller' } },
                },
              ]
            : [
                {
                  id: 'p2',
                  available: false,
                  unavailableReason: 'inactive',
                  capturedSourceVersion: 'version-2',
                  currentSourceVersion: 'version-2',
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
    expect(
      screen.getByText(/3 active products use legacy Gaming labels/)
    ).toBeInTheDocument();
    expect(
      screen.getByText('Changed since preview; showing current details.')
    ).toBeInTheDocument();
    expect(preview.querySelector('ul')).toHaveClass(
      'max-h-[40vh]',
      'overflow-y-auto'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));

    expect(await screen.findByText('Loading products…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    resolveSecondPage(
      Response.json({
        selectionId: 'selection-1',
        total: 51,
        page: 2,
        totalPages: 2,
        legacyUnmappedCount: 3,
        products: [
          {
            id: 'p2',
            available: false,
            unavailableReason: 'inactive',
            capturedSourceVersion: 'version-2',
            currentSourceVersion: 'version-2',
            product: null,
          },
        ],
      })
    );
    expect(await screen.findByText('inactive')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Loading products…')).not.toBeInTheDocument()
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
      'Unable to create a Gaming preview. Please retry.'
    );
    expect(
      screen.queryByText('sensitive database detail')
    ).not.toBeInTheDocument();
  });

  it('explains that duplicate active Gaming categories must be resolved', async () => {
    setupGamingCategories([
      { id: 'gaming-category-a' },
      { id: 'gaming-category-b' },
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
});
