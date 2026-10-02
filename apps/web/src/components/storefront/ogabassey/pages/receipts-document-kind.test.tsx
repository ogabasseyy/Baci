import { fireEvent, render, screen } from '@testing-library/react';
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

describe('OgabasseyV2Receipts document kind', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    mockReceiptContext();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('carries the resolved proforma kind into the modal renderer', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-proforma',
            order_number: 'ORD-PROFORMA',
            created_at: '2026-04-03T10:00:00.000Z',
            total: 100,
            amount_paid: 0,
            currency: 'NGN',
            payment_status: 'unpaid',
            payment_method: 'invoice',
            current_document_kind: 'invoice',
            invoice_type_code: '325',
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

    fireEvent.click(
      await screen.findByRole('button', { name: 'View Proforma' })
    );
    const modalProps = mockReceiptModal.mock.calls.at(-1)?.[0] as {
      documentKind: 'proforma' | null;
      orderData: { payment_status: string };
    };
    expect(modalProps.documentKind).toBe('proforma');
    expect(modalProps.orderData.payment_status).toBe('unpaid');
  });

  it('keeps the commercial receipt when a stale proforma code travels with a settled order', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        orders: [
          {
            id: 'order-settled',
            order_number: 'ORD-SETTLED',
            created_at: '2026-04-03T10:00:00.000Z',
            total: 100,
            amount_paid: 100,
            currency: 'NGN',
            payment_status: 'partially_paid',
            payment_method: 'invoice',
            current_document_kind: 'receipt',
            invoice_type_code: '325',
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

    fireEvent.click(
      await screen.findByRole('button', { name: 'View Receipt' })
    );
    const modalProps = mockReceiptModal.mock.calls.at(-1)?.[0] as {
      documentKind: 'proforma' | null;
      orderData: { payment_status: string };
    };
    expect(modalProps.documentKind).toBeNull();
    expect(modalProps.orderData.payment_status).toBe('paid');
  });
});
