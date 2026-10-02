import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import { useMerchantSafe } from '@/hooks/use-merchant-client';
import { OgabasseyV2Receipts } from './receipts';

const mockReceiptClaimAppDownloadBanner = vi.hoisted(() => vi.fn());
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
  ReceiptClaimAppDownloadBanner: () => {
    mockReceiptClaimAppDownloadBanner();
    return <div>Receipts ready</div>;
  },
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

describe('OgabasseyV2Receipts', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockReceiptContext();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('only mounts the app download banner for the Ogabassey merchant', async () => {
    vi.mocked(useMerchantSafe).mockReturnValue({
      merchant: {
        slug: 'merchant-using-ogabassey-template',
        business_name: 'Template Merchant',
        email: 'support@example.com',
        template_id: 'ogabassey',
      },
    } as ReturnType<typeof useMerchantSafe>);
    vi.mocked(fetch).mockResolvedValue(createJsonResponse({ orders: [] }));

    render(<OgabasseyV2Receipts />);

    expect(await screen.findByText('No receipts found')).toBeVisible();
    expect(mockReceiptClaimAppDownloadBanner).not.toHaveBeenCalled();
    expect(screen.queryByText('Receipts ready')).not.toBeInTheDocument();
  });

  it('opens settled manual balances as receipts while keeping the partial badge', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-001',
            created_at: '2026-04-03T10:00:00.000Z',
            total: 100,
            amount_paid: 100,
            currency: 'NGN',
            payment_status: 'partially_paid',
            current_document_kind: 'receipt',
            items: [
              {
                id: 'item-1',
                name: 'Samsung Galaxy S26',
                quantity: 1,
                price: 100,
              },
            ],
          },
        ],
      })
    );

    render(<OgabasseyV2Receipts />);

    expect(await screen.findByText('Partial')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View Receipt' }));
    const modalProps = mockReceiptModal.mock.calls.at(-1)?.[0] as {
      orderData: { payment_status: string };
    };
    expect(modalProps.orderData.payment_status).toBe('paid');
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

  it('uses the device name as the primary receipt label and the order number as supporting text', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-260403-00NN-J',
            created_at: '2026-04-03T10:00:00.000Z',
            total: 1283968.38,
            amount_paid: 1283968.38,
            currency: 'NGN',
            payment_status: 'paid',
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

    const deviceName = await screen.findByRole('heading', {
      name: 'Samsung Galaxy S26',
    });
    expect(deviceName).toBeVisible();
    expect(screen.getByText('#ORD-260403-00NN-J')).toBeVisible();
  });

  it('shows imported receipt conditions as variant labels in receipt cards', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-260724-04060',
            created_at: '2026-07-24T10:00:00.000Z',
            total: 930000,
            amount_paid: 930000,
            currency: 'NGN',
            payment_status: 'paid',
            items: [
              {
                id: 'item-1',
                name: 'Samsung Galaxy Z Fold 5 / Z Fold 5 12GB 512GB',
                variant_name: 'Used',
                image_url: 'https://cdn.example.com/fold-5.png',
                quantity: 1,
                price: 930000,
              },
            ],
          },
        ],
      })
    );

    render(<OgabasseyV2Receipts />);

    expect(
      await screen.findByRole('heading', {
        name: 'Samsung Galaxy Z Fold 5 / Z Fold 5 12GB 512GB (Used)',
      })
    ).toBeVisible();
  });

  it('falls back to item condition when a receipt item has no variant label', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-260724-04060',
            created_at: '2026-07-24T10:00:00.000Z',
            total: 930000,
            amount_paid: 930000,
            currency: 'NGN',
            payment_status: 'paid',
            items: [
              {
                condition: 'open_box',
                id: 'item-1',
                name: 'Samsung Galaxy Z Fold 5 / Z Fold 5 12GB 512GB',
                image_url: 'https://cdn.example.com/fold-5.png',
                quantity: 1,
                price: 930000,
              },
            ],
          },
        ],
      })
    );

    render(<OgabasseyV2Receipts />);

    expect(
      await screen.findByRole('heading', {
        name: 'Samsung Galaxy Z Fold 5 / Z Fold 5 12GB 512GB (Open Box)',
      })
    ).toBeVisible();
  });

  it('shows the additional device count when a receipt contains more than one device', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-1',
            order_number: 'ORD-003',
            created_at: '2026-04-03T10:00:00.000Z',
            total: 3000000,
            amount_paid: 3000000,
            currency: 'NGN',
            payment_status: 'paid',
            items: [
              {
                id: 'item-1',
                name: 'Samsung Galaxy S26',
                image_url: 'https://cdn.example.com/samsung-galaxy-s26.png',
                quantity: 1,
                price: 1283968.38,
              },
              {
                id: 'item-2',
                name: 'Lenovo ThinkBook 16 G7 IML',
                image_url: 'https://cdn.example.com/lenovo-thinkbook.png',
                quantity: 2,
                price: 858015.81,
              },
            ],
          },
        ],
      })
    );

    render(<OgabasseyV2Receipts />);

    const visualBadgeText = await screen.findByText('+2');
    expect(visualBadgeText).toHaveAttribute('aria-hidden', 'true');
    expect(
      screen.getByRole('heading', {
        name: /Samsung Galaxy S26.*2 additional devices in this receipt/,
      })
    ).toBeVisible();
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
