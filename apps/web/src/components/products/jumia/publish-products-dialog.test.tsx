import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PublishProductsDialog } from './publish-products-dialog';

const toast = vi.fn();
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ success: true, feedId: 'feed-1' }),
  }),
}));
vi.mock('./category-selector', () => ({
  JumiaCategorySelector: ({
    onSelect,
  }: {
    onSelect: (code: number) => void;
  }) => (
    <button type="button" onClick={() => onSelect(42)}>
      Choose category
    </button>
  ),
}));
vi.mock('./brand-selector', () => ({
  JumiaBrandSelector: ({
    onSelect,
  }: {
    onSelect: (brand: { code: number; name: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onSelect({ code: 1, name: 'Generic' })}
    >
      Choose brand
    </button>
  ),
}));

describe('PublishProductsDialog', () => {
  it('loads products and submits the selected product for approval', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('mapped-product-ids')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ mappings: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            products: [
              {
                id: 'p1',
                name: 'Phone',
                sku: 'SKU-1',
                price: 100,
                stock: 3,
                images: [{ url: 'https://cdn.example.com/phone.jpg' }],
              },
            ],
          }),
        });
      })
    );
    render(
      <PublishProductsDialog
        integrationId="int-1"
        merchantId="merchant-1"
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(await screen.findByText('Phone')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Phone'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose brand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit products' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Products submitted to Jumia' })
      )
    );
  });

  it('shows a destructive toast when product loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({}),
      })
    );
    render(
      <PublishProductsDialog
        integrationId="int-1"
        merchantId="merchant-1"
        open
        onOpenChange={vi.fn()}
      />
    );
    expect(
      await screen.findByText('Failed to load active products')
    ).toBeInTheDocument();
  });

  it('disables products already published to this Jumia integration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('mapped-product-ids')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              mappings: [
                { productId: 'p1', sellerSku: 'SKU-1', syncStatus: 'synced' },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            products: [{ id: 'p1', name: 'Published phone', price: 100 }],
          }),
        });
      })
    );

    render(
      <PublishProductsDialog
        integrationId="int-1"
        merchantId="merchant-1"
        open
        onOpenChange={vi.fn()}
      />
    );

    expect(await screen.findByText('Published phone')).toBeInTheDocument();
    expect(
      screen.getByText('Already published to this Jumia integration.')
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });
});
