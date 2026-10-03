import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { OgabasseyV2Receipts } from './receipts';

const mockReceiptModal = vi.hoisted(() => vi.fn());

vi.mock('@/contexts/customer-auth-context', () => ({
  useCustomerAuth: vi.fn(),
}));

vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: vi.fn(),
}));

vi.mock('../components/ReceiptModal', () => ({
  ReceiptModal: (props: unknown) => {
    mockReceiptModal(props);
    return <div data-testid="receipt-modal" />;
  },
}));

vi.mock('./receipt-claim-app-download-banner', () => ({
  ReceiptClaimAppDownloadBanner: () => <div>Receipts ready</div>,
}));

function createJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function mockReceiptContext() {
  vi.mocked(useCustomerAuth).mockReturnValue({
    user: {
      id: 'user-1',
      email: 'customer@example.com',
      role: 'customer',
    },
    customer: {
      id: 'customer-1',
      email: 'customer@example.com',
      first_name: 'Bassey',
      last_name: 'John',
    },
    isAuthenticated: true,
    isLoading: false,
    otpState: null,
    sendOtp: vi.fn(),
    verifyOtp: vi.fn(),
    signInWithGoogle: vi.fn(),
    signInWithApple: vi.fn(),
    logout: vi.fn(),
    refreshCustomer: vi.fn(),
    updateCustomer: vi.fn(),
  });

  vi.mocked(useMerchantSafe).mockReturnValue({
    merchant: {
      slug: 'ogabassey',
      business_name: 'Ogabassey',
      email: 'support@ogabassey.com',
      template_id: 'ogabassey',
    },
  } as ReturnType<typeof useMerchantSafe>);
}

describe('OgabasseyV2Receipts thumbnails', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockReceiptContext();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('uses order item image_url for receipt thumbnails', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-001',
            created_at: '2026-04-03T10:00:00.000Z',
            total: 1283968.38,
            amount_paid: 1283968.38,
            currency: 'NGN',
            payment_status: 'paid',
            shipping_status: 'shipped',
            items: [
              {
                id: 'item-1',
                name: 'Samsung Galaxy S26',
                image_url: 'https://cdn.example.com/samsung-galaxy-s26.png',
                quantity: 1,
                price: 1283968.38,
              },
            ],
          },
        ],
      })
    );

    render(<OgabasseyV2Receipts />);

    const thumbnail = await screen.findByAltText('Samsung Galaxy S26');
    expect(thumbnail).toHaveAttribute(
      'src',
      'https://cdn.example.com/samsung-galaxy-s26.png'
    );
  });

  it('renders a non-broken fallback when an order item has no usable image', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-002',
            created_at: '2026-04-02T10:00:00.000Z',
            total: 1464150,
            amount_paid: 0,
            currency: 'NGN',
            payment_status: 'unpaid',
            payment_method: 'invoice',
            items: [
              {
                id: 'item-1',
                name: 'Lenovo ThinkBook 16 G7 IML',
                image_url: '',
                quantity: 1,
                price: 1464150,
              },
            ],
          },
        ],
      })
    );

    render(<OgabasseyV2Receipts />);

    expect(
      await screen.findByRole('img', {
        name: 'No product image available for Lenovo ThinkBook 16 G7 IML',
      })
    ).toBeInTheDocument();
    expect(
      screen.queryByAltText('Lenovo ThinkBook 16 G7 IML')
    ).not.toBeInTheDocument();
  });
});
