import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { asRoute } from '@/lib/routes';
import type { StorefrontOrderData } from './fetch-storefront-order';
import { OrderSuccessInvoiceCta } from './order-success-invoice-cta';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: React.ReactNode;
    href: string;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function paidOrder(
  overrides: Partial<StorefrontOrderData> = {}
): StorefrontOrderData {
  return {
    id: 'order-123',
    order_number: 'ORD-123',
    customer_email: 'buyer@example.com',
    payment_status: 'paid',
    payment_method: 'invoice',
    shipping_status: 'pending',
    items: [],
    subtotal: 45000,
    shipping_cost: 1500,
    total: 49875,
    ...overrides,
  };
}

describe('OrderSuccessInvoiceCta', () => {
  it('links a paid unshipped order directly at the commercial invoice', () => {
    render(
      <OrderSuccessInvoiceCta
        archiveHref={asRoute('/test-store/receipts')}
        isAuthed
        isDelivered
        isInvoice={false}
        merchantSlug="test-store"
        order={paidOrder()}
      />
    );

    expect(
      screen.getByRole('link', { name: /download commercial invoice pdf/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-123/invoice?merchantSlug=test-store'
    );
  });

  it('links a paid shipped order directly at the receipt', () => {
    render(
      <OrderSuccessInvoiceCta
        archiveHref={asRoute('/test-store/receipts')}
        isAuthed
        isDelivered
        isInvoice={false}
        merchantSlug="test-store"
        order={paidOrder({ shipping_status: 'delivered' })}
      />
    );

    expect(
      screen.getByRole('link', { name: /download receipt pdf/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-123/receipt?merchantSlug=test-store'
    );
  });

  it('keeps the archive proforma link for unpaid orders', () => {
    render(
      <OrderSuccessInvoiceCta
        archiveHref={asRoute('/test-store/receipts')}
        isAuthed
        isDelivered
        isInvoice
        merchantSlug="test-store"
        order={paidOrder({ payment_status: 'unpaid' })}
      />
    );

    expect(
      screen.getByRole('link', { name: /download proforma invoice pdf/i })
    ).toHaveAttribute('href', '/test-store/receipts');
  });

  it('falls back to the archive when the direct document is unavailable', () => {
    render(
      <OrderSuccessInvoiceCta
        archiveHref={asRoute('/test-store/receipts')}
        isAuthed
        isDelivered
        isInvoice={false}
        merchantSlug={null}
        order={paidOrder()}
      />
    );

    expect(
      screen.getByRole('link', { name: /download commercial invoice pdf/i })
    ).toHaveAttribute('href', '/test-store/receipts');
  });

  it('gives guests the pending action until delivery lands', () => {
    render(
      <OrderSuccessInvoiceCta
        archiveHref={asRoute('/test-store/receipts')}
        isAuthed={false}
        isDelivered={false}
        isInvoice
        merchantSlug="test-store"
        order={paidOrder({ payment_status: 'unpaid' })}
      />
    );

    // Delivery runs in after(), after the first lookup: no false "sent".
    expect(
      screen.getByText(
        /proforma invoice pdf is being prepared — we'll email it to buyer@example\.com/i
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('gives guests the sent action once delivery lands', () => {
    render(
      <OrderSuccessInvoiceCta
        archiveHref={asRoute('/test-store/receipts')}
        isAuthed={false}
        isDelivered
        isInvoice
        merchantSlug="test-store"
        order={paidOrder({ payment_status: 'unpaid' })}
      />
    );

    expect(
      screen.getByText(/proforma invoice pdf was sent to buyer@example\.com/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });
});
