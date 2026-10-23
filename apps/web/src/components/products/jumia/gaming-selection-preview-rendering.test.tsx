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

describe('GamingSelectionPreview rendering and pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('creates and pages a preview only, without selection or submit controls', async () => {
    setupGamingCategories();
    const fetcher = vi.mocked((await import('@/lib/api-client')).fetchWithCsrf);
    fetcher.mockResolvedValue(
      Response.json(
        {
          selectionId: 'selection-1',
          total: 51,
          expiresAt: '2099-01-01T00:00:00.000Z',
        },
        { status: 201 }
      )
    );
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
        products: [
          {
            id: 'p1',
            available: true,
            unavailableReason: null,
            capturedSourceVersion: 'captured-version',
            currentSourceVersion: 'current-version',
            product: { product: { name: 'Controller' } },
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
    expect(
      await screen.findByText('Unavailable product (p2)')
    ).toBeInTheDocument();
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
});
