import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetchWithCsrf = vi.fn();

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  useParams: vi.fn(() => ({ orderId: 'order-1' })),
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
    merchant: { slug: 'ogabassey' },
    loading: false,
    basePath: '/ogabassey',
  })),
}));

import { useRouter } from 'next/navigation';
import { useCustomerAuth } from '@/contexts/customer-auth-context';
import CustomerOrderDetailsPage from './customer-order-details-client';

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

describe('CustomerOrderDetailsPage', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('shows an invoice CTA before the receipt is eligible', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        order: {
          id: 'order-1',
          order_number: 'ORD-1001',
          created_at: '2026-03-22T10:00:00.000Z',
          shipping_status: 'processing',
          payment_status: 'paid',
          payment_method: 'card',
          subtotal: 100000,
          total: 100000,
          shipping_fee: 0,
          currency: 'NGN',
          current_document_kind: 'invoice',
          items: [
            {
              id: 'item-1',
              product_id: 'prod-1',
              name: 'iPhone 16',
              product_name: 'iPhone 16',
              quantity: 1,
              price: 100000,
            },
          ],
          transactions: [],
        },
      })
    );

    render(<CustomerOrderDetailsPage />);

    expect(
      await screen.findByRole('link', { name: /download invoice/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-1/invoice?merchantSlug=ogabassey'
    );
  });

  it('shows a receipt CTA and uses the products route for buy again', async () => {
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({
        order: {
          id: 'order-1',
          order_number: 'ORD-1001',
          created_at: '2026-03-22T10:00:00.000Z',
          shipping_status: 'shipped',
          payment_status: 'paid',
          payment_method: 'card',
          subtotal: 100000,
          total: 100000,
          shipping_fee: 0,
          currency: 'NGN',
          current_document_kind: 'receipt',
          receipt_eligible: true,
          items: [
            {
              id: 'item-1',
              product_id: 'prod-1',
              name: 'iPhone 16',
              product_name: 'iPhone 16',
              quantity: 1,
              price: 100000,
            },
          ],
          transactions: [],
        },
      })
    );

    render(<CustomerOrderDetailsPage />);

    expect(
      await screen.findByRole('link', { name: /download receipt/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-1/receipt?merchantSlug=ogabassey'
    );
    expect(
      await screen.findByRole('link', { name: /buy again/i })
    ).toHaveAttribute('href', '/ogabassey/products/prod-1');
  });

  it('shows error UI when the order request fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 404,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Order not found' }),
    } as Response);

    render(<CustomerOrderDetailsPage />);

    expect(
      await screen.findByRole('heading', { name: /order unavailable/i })
    ).toBeInTheDocument();
    expect(screen.getByText(/order not found/i)).toBeInTheDocument();
  });

  it('shows a loading state while the order request is pending', async () => {
    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      })
    );

    render(<CustomerOrderDetailsPage />);

    expect(
      screen.getByRole('status', { name: /loading order/i })
    ).toBeInTheDocument();

    resolveFetch(
      createJsonResponse({
        order: {
          id: 'order-1',
          order_number: 'ORD-1001',
          created_at: '2026-03-22T10:00:00.000Z',
          shipping_status: 'processing',
          payment_status: 'paid',
          payment_method: 'card',
          subtotal: 100000,
          total: 100000,
          shipping_fee: 0,
          currency: 'NGN',
          current_document_kind: 'invoice',
          items: [],
          transactions: [],
        },
      })
    );

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /download invoice/i })
      ).toBeInTheDocument();
    });
  });

  it('re-fetches the order after a successful cancellation', async () => {
    const cancellableOrder = {
      id: 'order-1',
      order_number: 'ORD-1001',
      created_at: '2026-03-22T10:00:00.000Z',
      shipping_status: 'processing',
      payment_status: 'unpaid',
      payment_method: 'bank_transfer',
      subtotal: 100000,
      total: 100000,
      shipping_fee: 0,
      currency: 'NGN',
      current_document_kind: 'invoice',
      can_cancel: true,
      items: [],
      transactions: [],
    };
    vi.mocked(fetch).mockResolvedValue(
      createJsonResponse({ order: cancellableOrder })
    );
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, cancelled: true }),
    } as Response);

    render(<CustomerOrderDetailsPage />);

    const cancelButton = await screen.findByRole('button', {
      name: /cancel order/i,
    });
    const fetchCallsBeforeCancel = vi.mocked(fetch).mock.calls.length;

    fireEvent.click(cancelButton);
    fireEvent.click(
      screen.getByRole('button', { name: /^confirm cancellation$/i })
    );

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        '/api/storefront/account/orders/order-1/cancel',
        expect.objectContaining({ method: 'POST' })
      );
    });
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(
        fetchCallsBeforeCancel
      );
    });
  });

  it('redirects unauthenticated customers to login', async () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push } as never);
    vi.mocked(useCustomerAuth).mockReturnValue({
      customer: null,
      isAuthenticated: false,
      isLoading: false,
    } as never);

    render(<CustomerOrderDetailsPage />);

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        '/ogabassey/account/login?redirect=%2Fogabassey%2Faccount%2Forders%2Forder-1'
      );
    });
  });
});
