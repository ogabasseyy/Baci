import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from './actions';
import { OrderCardDetails } from './order-card-details';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'ORD-001',
    customerName: 'Ada Lovelace',
    total: 25000,
    currency: 'NGN',
    shippingStatus: 'Pending',
    paymentStatus: 'Pending',
    paymentMethod: 'card',
    date: 'Mar 23, 2026',
    createdAt: Date.now(),
    source: 'website',
    tracking_number: 'TRK-001',
    shipping_provider: 'Topship',
    items: [
      {
        id: 'item-1',
        name: 'Widget',
        quantity: 1,
        price: 25000,
      },
    ],
    ...overrides,
  };
}

describe('OrderCardDetails', () => {
  it('renders fulfillment and item details for the expanded card', () => {
    render(
      <OrderCardDetails
        order={makeOrder()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(screen.getByText('Item Details')).toBeInTheDocument();
    expect(screen.getByText('Topship')).toBeInTheDocument();
    expect(screen.getByText('TRK-001')).toBeInTheDocument();
  });

  it('omits tracking details when fulfillment data is missing', () => {
    render(
      <OrderCardDetails
        order={makeOrder({
          tracking_number: undefined,
          shipping_provider: undefined,
        })}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(screen.getByText('Item Details')).toBeInTheDocument();
    expect(screen.queryByText('TRK-001')).not.toBeInTheDocument();
    expect(screen.queryByText('Topship')).not.toBeInTheDocument();
    expect(screen.queryByText('Default Variant')).not.toBeInTheDocument();
  });

  it('renders a detail link for non-jumia orders', () => {
    render(
      <OrderCardDetails
        order={makeOrder({ orderNumber: '#ORD-001', source: 'website' })}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(
      screen.getByRole('link', { name: 'Open Order Details' })
    ).toHaveAttribute('href', '/dashboard/orders/ORD-001');
  });

  it('omits the detail link for jumia orders', () => {
    render(
      <OrderCardDetails
        order={makeOrder({ source: 'jumia' })}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(
      screen.queryByRole('link', { name: 'Open Order Details' })
    ).not.toBeInTheDocument();
  });

  it('passes the order currency to the item formatter', () => {
    const formatCurrency = vi.fn(
      (amount: number, currency?: string | null) => `${currency}:${amount}`
    );

    render(
      <OrderCardDetails
        order={makeOrder({ source: 'jumia', currency: 'KES' })}
        formatCurrency={formatCurrency}
      />
    );

    expect(formatCurrency).toHaveBeenCalledWith(25000, 'KES');
    expect(screen.getByText('KES:25000')).toBeInTheDocument();
  });
});
