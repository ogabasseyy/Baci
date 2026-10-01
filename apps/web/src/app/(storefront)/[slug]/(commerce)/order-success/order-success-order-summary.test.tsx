import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorefrontOrderData } from './fetch-storefront-order';
import { OrderSuccessOrderSummary } from './order-success-order-summary';

const baseOrder: StorefrontOrderData = {
  id: 'order-12345678',
  order_number: 'BAC-001',
  total: 21500,
  items: [{ id: 'i1' }, { id: 'i2' }],
  customer_email: 'buyer@example.com',
} as never;

describe('OrderSuccessOrderSummary', () => {
  it('renders the order number, count, total, and email', () => {
    render(
      <OrderSuccessOrderSummary
        formatCurrency={(amount) => `NGN ${amount}`}
        order={baseOrder}
      />
    );

    expect(screen.getByText('#BAC-001')).toBeInTheDocument();
    expect(screen.getByText('Items (2)')).toBeInTheDocument();
    expect(screen.getByText('NGN 21500')).toBeInTheDocument();
    expect(screen.getByText('buyer@example.com')).toBeInTheDocument();
  });

  it('falls back to the id prefix and hides a missing email', () => {
    render(
      <OrderSuccessOrderSummary
        formatCurrency={(amount) => `${amount}`}
        order={{ ...baseOrder, order_number: '', customer_email: undefined }}
      />
    );

    expect(screen.getByText('#order-12')).toBeInTheDocument();
    expect(screen.queryByText('buyer@example.com')).not.toBeInTheDocument();
  });
});
