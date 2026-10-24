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
    onSelect: (category: {
      code: number;
      name: string;
      attributeSetId: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelect({
          code: 42,
          name: 'Games',
          attributeSetId: '11111111-1111-4111-8111-111111111111',
        })
      }
    >
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
  it('clears legacy choices on same-merchant integration replacement while keeping the snapshot mounted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          Response.json(
            url.includes('mapped-product-ids')
              ? { mappings: [] }
              : url.includes('destination-context')
                ? { businessClients: [] }
                : {
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
                  }
          )
        )
      )
    );
    const { rerender } = render(
      <PublishProductsDialog
        merchantId="merchant"
        integrationId="old"
        open
        onOpenChange={vi.fn()}
      />
    );
    await screen.findByText('Phone');
    fireEvent.click(screen.getByText('Phone'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose brand' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    const frozenPreview = screen.getByRole('region', {
      name: 'Gaming selection preview',
    });
    rerender(
      <PublishProductsDialog
        merchantId="merchant"
        integrationId="new"
        open
        onOpenChange={vi.fn()}
      />
    );
    await screen.findByText('Phone');
    expect(screen.getByText('0 selected')).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Gaming selection preview' })
    ).toBe(frozenPreview);
  });
  it('keeps the dialog content within the viewport and scrollable', () => {
    render(
      <PublishProductsDialog
        integrationId="int-1"
        merchantId="merchant-1"
        open
        onOpenChange={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog')).toHaveClass(
      'max-h-[calc(100dvh-2rem)]',
      'overflow-y-auto'
    );
  });

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
