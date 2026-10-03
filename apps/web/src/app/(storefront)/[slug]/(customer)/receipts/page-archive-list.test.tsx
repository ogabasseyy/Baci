import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceiptsPage from '@/app/(storefront)/[slug]/(customer)/receipts/page';
import { useMerchant } from '@/hooks/use-merchant-client';

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));

vi.mock('next/link', () => ({
  default: vi.fn(
    ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  ),
}));

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(() => ({
    customer: { id: 'customer-1' },
    isAuthenticated: true,
    isLoading: false,
  })),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: vi.fn(() => ({
    merchant: { slug: 'default', template_id: 'default' },
    loading: false,
    basePath: '/default',
  })),
}));

vi.mock('@/components/storefront/ogabassey/pages/receipts', () => ({
  OgabasseyV2Receipts: () => (
    <div data-testid="ogabassey-receipts-page">Ogabassey Receipts Page</div>
  ),
}));

function createJsonResponse(body: unknown): Response {
  const textBody = JSON.stringify(body);

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => textBody,
    clone() {
      return createJsonResponse(body);
    },
  } as Response;
}

type MockMerchantReturn = ReturnType<typeof useMerchant>;

function createMerchantMock({
  basePath,
  slug,
  templateId,
}: {
  basePath: string;
  slug: string;
  templateId: string;
}): MockMerchantReturn {
  return {
    merchant: {
      id: `${slug}-merchant-id`,
      user_id: `${slug}-owner-id`,
      business_name: `${slug} Store`,
      business_type: 'electronics',
      slug,
      template_id: templateId,
    },
    loading: false,
    updateMerchant: vi.fn(),
    reloadMerchant: vi.fn(),
    staffAccess: {
      isStaff: false,
      isOwner: true,
      role: null,
      permissions: {},
    },
    hasPermission: vi.fn(() => true),
    routingMode: 'path',
    basePath,
    navigationCategories: [],
  };
}

describe('ReceiptsPage archive list', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(useMerchant).mockReturnValue(
      createMerchantMock({
        slug: 'default',
        templateId: 'default',
        basePath: '/default',
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows fulfilled orders plus imported paid receipts in the archive', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-processing',
            order_number: 'ORD-1000',
            created_at: '2026-03-21T10:00:00.000Z',
            total: 10000,
            currency: 'NGN',
            shipping_status: 'processing',
            current_document_kind: 'invoice',
            receipt_eligible: false,
            items: [
              {
                id: 'item-1',
                name: 'Pending Item',
                quantity: 1,
                price: 10000,
              },
            ],
          },
          {
            id: 'order-shipped',
            order_number: 'ORD-1001',
            created_at: '2026-03-22T10:00:00.000Z',
            total: 20000,
            currency: 'NGN',
            shipping_status: 'shipped',
            current_document_kind: 'invoice',
            receipt_eligible: false,
            items: [
              {
                id: 'item-2',
                name: 'Shipped Item',
                quantity: 1,
                price: 20000,
              },
            ],
          },
          {
            id: 'order-delivered',
            order_number: 'ORD-1002',
            created_at: '2026-03-23T10:00:00.000Z',
            total: 30000,
            currency: 'NGN',
            shipping_status: 'delivered',
            current_document_kind: 'receipt',
            receipt_eligible: true,
            items: [
              {
                id: 'item-3',
                name: 'Delivered Item',
                quantity: 1,
                price: 30000,
              },
            ],
          },
          {
            id: 'order-imported-receipt',
            order_number: 'ORD-1003',
            created_at: '2026-03-24T10:00:00.000Z',
            total: 40000,
            currency: 'NGN',
            shipping_status: 'processing',
            current_document_kind: 'receipt',
            receipt_eligible: true,
            items: [
              {
                id: 'item-4',
                name: 'Imported Paid Item',
                quantity: 1,
                price: 40000,
              },
            ],
          },
          {
            id: 'order-invoice-unpaid',
            order_number: 'ORD-1004',
            created_at: '2026-03-25T10:00:00.000Z',
            total: 50000,
            currency: 'NGN',
            shipping_status: 'processing',
            current_document_kind: 'invoice',
            receipt_eligible: false,
            payment_method: 'invoice',
            items: [
              {
                id: 'item-5',
                name: 'Invoice Item',
                quantity: 1,
                price: 50000,
              },
            ],
          },
          {
            id: 'manual-partial',
            order_number: 'MANUAL-PARTIAL',
            created_at: '2026-09-30T09:00:00Z',
            total: 100,
            shipping_status: 'pending',
            current_document_kind: 'invoice',
            is_manual_order: true,
            manual_document_available: true,
            receipt_eligible: false,
            items: [
              {
                id: 'manual-item',
                name: 'Manual Device',
                quantity: 1,
                price: 100,
              },
            ],
          },
        ],
      })
    );

    render(<ReceiptsPage />);

    expect(await screen.findByText('#ORD-1001')).toBeInTheDocument();
    expect(screen.getByText('#ORD-1002')).toBeInTheDocument();
    expect(screen.getByText('#ORD-1003')).toBeInTheDocument();
    expect(screen.getByText('#ORD-1004')).toBeInTheDocument();
    expect(screen.getByText('#MANUAL-PARTIAL')).toBeInTheDocument();
    expect(screen.queryByText('#ORD-1000')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('link', { name: /download invoice/i })[0]
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-shipped/invoice?merchantSlug=default'
    );
    expect(
      screen.getAllByRole('link', { name: /download invoice/i })[1]
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-invoice-unpaid/invoice?merchantSlug=default'
    );
    expect(
      screen.getAllByRole('link', { name: /download receipt/i })[0]
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-delivered/receipt?merchantSlug=default'
    );
    expect(
      screen.getAllByRole('link', { name: /download receipt/i })[1]
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-imported-receipt/receipt?merchantSlug=default'
    );
  });
});
