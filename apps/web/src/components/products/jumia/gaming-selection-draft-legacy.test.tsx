import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
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
vi.mock('./use-gaming-selection-preview', () => ({
  useGamingSelectionPreview: () => ({
    snapshot: {
      selectionId: '00000000-0000-4000-8000-000000000020',
      sourceCategoryId: '00000000-0000-4000-8000-000000000010',
      page: 1,
      total: 1,
      limit: 50,
      totalPages: 1,
      legacyUnmappedCount: 0,
      products: [
        {
          id: '00000000-0000-4000-8000-000000000001',
          ordinal: 1,
          available: true,
          unavailableReason: null,
          capturedSourceVersion: 'a'.repeat(64),
          currentSourceVersion: 'a'.repeat(64),
          product: { product: { name: 'Draft Gamepad' } },
        },
      ],
    },
    loading: false,
    error: null,
    creationOutcomeUnknown: false,
    createPreview: vi.fn(),
    goToPage: vi.fn(),
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

describe('Gaming draft and legacy publisher separation', () => {
  it('never submits draft IDs through the legacy action and preserves legacy submission', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('mapped-product-ids')
            ? { mappings: [] }
            : {
                products: [
                  {
                    id: 'legacy-phone',
                    name: 'Legacy Phone',
                    sku: 'PHONE',
                    price: 100,
                    stock: 3,
                    images: [{ url: 'https://cdn.example.com/phone.jpg' }],
                  },
                ],
              },
      }))
    );
    render(
      <PublishProductsDialog
        integrationId="int-1"
        merchantId="merchant-1"
        open
        onOpenChange={vi.fn()}
      />
    );
    await screen.findByText('Legacy Phone');
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Draft Gamepad for draft' })
    );
    expect(screen.getByText('1 selected in draft')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose category' }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose brand' }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit products' }));
    expect(fetchWithCsrf).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Legacy Phone'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit products' }));
    await waitFor(() => expect(fetchWithCsrf).toHaveBeenCalledOnce());
    const options = vi.mocked(fetchWithCsrf).mock.calls[0][1];
    expect(JSON.parse(String(options?.body)).productId).toBe('legacy-phone');
    expect(String(options?.body)).not.toContain(
      '00000000-0000-4000-8000-000000000001'
    );
  });
});
