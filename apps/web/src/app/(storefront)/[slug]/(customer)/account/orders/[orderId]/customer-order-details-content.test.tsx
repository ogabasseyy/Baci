import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CustomerOrderDetailsContent } from '@/app/(storefront)/[slug]/(customer)/account/orders/[orderId]/customer-order-details-content';
import type { StorefrontOrder } from '@/types/storefront-order';

vi.mock('next/link', () => ({
  default: vi.fn(
    ({ children, href, ...rest }: { children: ReactNode; href: string }) => (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  ),
}));

const baseOrder: StorefrontOrder = {
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
      variant_name: 'Blue / 128GB',
      quantity: 1,
      price: 100000,
    },
  ],
  transactions: [],
};

describe('CustomerOrderDetailsContent', () => {
  it('renders the invoice CTA before the receipt is eligible', () => {
    render(
      <CustomerOrderDetailsContent
        order={baseOrder}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.getByRole('link', { name: /download invoice/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-1/invoice?merchantSlug=ogabassey'
    );
    expect(
      screen.getByText(
        /receipts become available after the order has been shipped/i
      )
    ).toBeInTheDocument();
  });

  it('labels the CTA as a proforma invoice for unresolved 325 orders', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          payment_status: 'unpaid',
          payment_method: 'invoice',
          current_document_kind: 'invoice',
          invoice_type_code: '325',
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    // Same document the invoice route downloads as a proforma file; the
    // href keeps the invoice route segment.
    expect(
      screen.getByRole('link', { name: /download proforma invoice/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-1/invoice?merchantSlug=ogabassey'
    );
  });

  it('renders the receipt CTA and valid product routes once eligible', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_status: 'shipped',
          current_document_kind: 'receipt',
          receipt_eligible: true,
          rider_phone_number: '08012345678',
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.getByRole('link', { name: /download receipt/i })
    ).toHaveAttribute(
      'href',
      '/api/storefront/account/orders/order-1/receipt?merchantSlug=ogabassey'
    );
    expect(
      screen.queryByRole('link', { name: /download invoice/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        /receipts become available after the order has been shipped/i
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText('Shipped')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /call rider 08012345678/i })
    ).toHaveAttribute('href', 'tel:08012345678');
    expect(screen.getByRole('link', { name: /buy again/i })).toHaveAttribute(
      'href',
      '/ogabassey/products/prod-1'
    );
    expect(screen.getByText('Blue / 128GB')).toBeInTheDocument();
  });

  it('renders condition and variant metadata for order items', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          items: [
            {
              ...baseOrder.items[0],
              condition: 'open_box',
              variant_name: 'Blue / 128GB',
            },
          ],
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.getByText('Open Box / Blue / 128GB')).toBeInTheDocument();
  });

  it('omits item metadata when condition and variant are absent', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          items: [
            {
              ...baseOrder.items[0],
              condition: null,
              variant_name: null,
            },
          ],
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.queryByText('Open Box')).not.toBeInTheDocument();
    expect(screen.queryByText('Blue / 128GB')).not.toBeInTheDocument();
  });

  it('shows the cancel order CTA when the order is server-cancellable', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_status: 'processing',
          payment_status: 'unpaid',
          can_cancel: true,
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.getByRole('button', { name: /cancel order/i })
    ).toBeInTheDocument();
  });

  it('hides the cancel order CTA when the order is not cancellable', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_status: 'processing',
          payment_status: 'unpaid',
          can_cancel: false,
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.queryByRole('button', { name: /cancel order/i })
    ).not.toBeInTheDocument();
  });

  it('renders the bought rate name for a merchant-rate order', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_provider: 'MERCHANT',
          shipping_rate_name: 'Express Delivery',
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.getByText('Express Delivery')).toBeInTheDocument();
    expect(screen.queryByText('MERCHANT')).not.toBeInTheDocument();
  });

  it('renders the pickup collection address and instructions for a merchant-pickup order', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_provider: 'MERCHANT_PICKUP',
          shipping_rate_name: 'Store Pickup',
          shipping_pickup_details: {
            label: 'Ikeja Flagship Store',
            address: '12 Allen Avenue',
            city: 'Ikeja',
            state: 'Lagos',
            countryCode: 'NG',
            instructions: 'Ring the bell twice and ask for Ada',
          },
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.getByText('Ikeja Flagship Store')).toBeInTheDocument();
    expect(
      screen.getByText('12 Allen Avenue, Ikeja, Lagos')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Ring the bell twice and ask for Ada')
    ).toBeInTheDocument();
  });

  it('renders no pickup location block when the snapshot is null', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_provider: 'MERCHANT_PICKUP',
          shipping_rate_name: 'Store Pickup',
          shipping_pickup_details: null,
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.queryByText(/pickup location/i)).not.toBeInTheDocument();
  });

  it('does not render a pickup location block for a non-pickup order carrying a stray snapshot', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_provider: 'MERCHANT',
          shipping_rate_name: 'Express Delivery',
          shipping_pickup_details: {
            label: 'Should Not Show',
            address: '99 Hidden Road',
          },
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.queryByText('Should Not Show')).not.toBeInTheDocument();
    expect(screen.queryByText('99 Hidden Road')).not.toBeInTheDocument();
  });

  it('falls back to the provider label when the rate name is absent', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_provider: 'GIGL',
          shipping_rate_name: undefined,
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(screen.getByText('GIGL')).toBeInTheDocument();
  });

  it('shows review and return actions once the order is delivered', () => {
    render(
      <CustomerOrderDetailsContent
        order={{
          ...baseOrder,
          shipping_status: 'delivered',
          current_document_kind: 'receipt',
          receipt_eligible: true,
          merchant_support_email: 'support@ogabassey.com',
        }}
        basePath="/ogabassey"
        merchantSlug="ogabassey"
      />
    );

    expect(
      screen.getByRole('link', { name: /leave a google review/i })
    ).toHaveAttribute('href', 'https://g.page/r/CR1gsFYL8eu9EBM/review');
    expect(screen.getByRole('link', { name: /return order/i })).toHaveAttribute(
      'href',
      'mailto:support@ogabassey.com?subject=Return%20request%20for%20order%20ORD-1001'
    );
  });
});
