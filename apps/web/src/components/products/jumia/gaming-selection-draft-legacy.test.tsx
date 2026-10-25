import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('Gaming draft and legacy publisher separation', () => {
  beforeEach(() => {
    vi.mocked(fetchWithCsrf).mockClear();
  });

  it('previews only the selected frozen product on the current page without submitting it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('mapped-product-ids'))
          return Response.json({ mappings: [] });
        if (url.includes('destination-context'))
          return Response.json({
            businessClients: [
              { code: 'NG-RETAIL', name: 'Nigeria Retail', countryCode: 'NG' },
            ],
          });
        if (url.includes('attribute-sets'))
          return Response.json({ attributes: [] });
        return Response.json({
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
        });
      })
    );
    const response = {
      scope: {
        selectionId: '00000000-0000-4000-8000-000000000020',
        sourceCategoryId: '00000000-0000-4000-8000-000000000010',
        sourcePage: { page: 1, limit: 50 },
        productIds: ['00000000-0000-4000-8000-000000000001'],
      },
      digest: `jumia-preflight-v1:${'a'.repeat(64)}`,
      products: [
        {
          productId: '00000000-0000-4000-8000-000000000001',
          sourceVersion: 'a'.repeat(64),
          locallyValid: false,
          blockers: ['evidence.globalPrice:global_price_unproven'],
          recordCount: 0,
        },
      ],
      canSubmit: false,
    };
    vi.mocked(fetchWithCsrf).mockResolvedValueOnce(Response.json(response));
    render(
      <PublishProductsDialog
        integrationId="00000000-0000-4000-8000-000000000031"
        merchantId="00000000-0000-4000-8000-000000000032"
        open
        onOpenChange={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Select Draft Gamepad for draft' })
    );
    await screen.findByRole('option', { name: 'Nigeria Retail (NG-RETAIL)' });
    fireEvent.change(
      screen.getByLabelText('Draft destination business client'),
      {
        target: { value: 'NG-RETAIL' },
      }
    );
    const mappingDraft = screen.getByRole('region', {
      name: 'Jumia mapping draft',
    });
    fireEvent.click(within(mappingDraft).getByText('Choose category'));
    fireEvent.click(within(mappingDraft).getByText('Choose brand'));
    const bullets = await screen.findByLabelText(
      'Product bullets (one per line)'
    );
    fireEvent.change(bullets, {
      target: {
        value:
          'Reliable controls\nComfortable grip\nLow-latency input\nDurable finish',
      },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Confirm draft category: Games' })
    );
    await screen.findByText(/Draft category confirmed: Games/);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Confirm mapping for this selected page',
      })
    );
    const checkButton = await screen.findByRole('button', {
      name: 'Check selected products on this page',
    });
    expect(checkButton).toBeEnabled();
    fireEvent.click(checkButton);

    expect(vi.mocked(fetchWithCsrf)).toHaveBeenCalledOnce();
    await screen.findByText('evidence.globalPrice:global_price_unproven');
    const previewCall = vi.mocked(fetchWithCsrf).mock.calls[0];
    expect(previewCall[0]).toBe('/api/marketplace/jumia/products/preflight');
    expect(previewCall[1]).toMatchObject({ method: 'POST' });
    const body = JSON.parse(String(previewCall[1]?.body));
    expect(body).toMatchObject({
      merchantId: '00000000-0000-4000-8000-000000000032',
      integrationId: '00000000-0000-4000-8000-000000000031',
      businessClientCode: 'NG-RETAIL',
      sourcePage: { page: 1, limit: 50 },
      products: [
        {
          productId: '00000000-0000-4000-8000-000000000001',
          sourceVersion: 'a'.repeat(64),
        },
      ],
      mappings: [
        {
          productId: '00000000-0000-4000-8000-000000000001',
          bullets: [
            'Reliable controls',
            'Comfortable grip',
            'Low-latency input',
            'Durable finish',
          ],
          categoryConfirmed: true,
        },
      ],
    });
    expect(body).not.toHaveProperty('price');
    expect(body).not.toHaveProperty('globalPrice');
    expect(body).not.toHaveProperty('images');
    expect(body).not.toHaveProperty('source');
    expect(body).not.toHaveProperty('evidence');
    expect(body.products[0]).not.toHaveProperty('price');
    expect(body.products[0]).not.toHaveProperty('stock');
    expect(body.products[0]).not.toHaveProperty('source');
    expect(body.mappings[0]).not.toHaveProperty('evidence');
    expect(body.mappings[0]).not.toHaveProperty('globalPrice');
    expect(body.mappings[0]).not.toHaveProperty('images');
    expect(body.mappings[0]).not.toHaveProperty('providerClassification');
    expect(screen.getByText('canSubmit: false')).toBeInTheDocument();
    expect(vi.mocked(fetchWithCsrf).mock.calls).toHaveLength(1);
  });

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
