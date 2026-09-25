import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from './actions';
import { OrderCard } from './order-card';

vi.mock('next/image', () => ({
  default: ({ fill: _fill, ...props }: Record<string, unknown>) => (
    // biome-ignore lint/performance/noImgElement: test mock
    <img {...props} alt={props.alt as string} />
  ),
}));

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

describe('OrderCard', () => {
  it('renders a singular item label for a single item order', () => {
    render(
      <OrderCard
        order={makeOrder()}
        isSelected={false}
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(screen.getByText('1 item: Widget')).toBeInTheDocument();
  });

  it('renders plural item labels for multi-item orders', () => {
    render(
      <OrderCard
        order={makeOrder({
          items: [
            { id: 'item-1', name: 'Widget', quantity: 1, price: 15000 },
            { id: 'item-2', name: 'Gadget', quantity: 1, price: 10000 },
          ],
        })}
        isSelected={false}
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(screen.getByText('2 items: Widget, Gadget')).toBeInTheDocument();
  });

  it('marks the card as selected when isSelected is true', () => {
    render(
      <OrderCard
        order={makeOrder()}
        isSelected
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(screen.getByTestId('order-card')).toHaveAttribute(
      'data-selected',
      'true'
    );
  });

  it('expands when a non-interactive part of the card is clicked', async () => {
    const user = userEvent.setup();

    render(
      <OrderCard
        order={makeOrder()}
        isSelected={false}
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    await user.click(screen.getByText('1 item: Widget'));

    expect(screen.getByText('Item Details')).toBeInTheDocument();
  });

  it('links regular orders to the dashboard detail page', () => {
    render(
      <OrderCard
        order={makeOrder({ orderNumber: '#ORD-001', source: 'website' })}
        isSelected={false}
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(screen.getByRole('link', { name: 'Ada Lovelace' })).toHaveAttribute(
      'href',
      '/dashboard/orders/ORD-001'
    );
  });

  it('does not link jumia orders to the regular detail page', () => {
    render(
      <OrderCard
        order={makeOrder({ source: 'jumia' })}
        isSelected={false}
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    expect(
      screen.queryByRole('link', { name: 'Ada Lovelace' })
    ).not.toBeInTheDocument();
  });

  it('calls onSelect when the checkbox is toggled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <OrderCard
        order={makeOrder()}
        isSelected={false}
        onSelect={onSelect}
        onStatusUpdate={vi.fn()}
        formatCurrency={(amount) => `₦${amount}`}
      />
    );

    await user.click(screen.getByLabelText('Select order ORD-001'));

    expect(onSelect).toHaveBeenCalledWith('ORD-001', true);
  });

  it('passes the order currency to the total formatter', () => {
    const formatCurrency = vi.fn(
      (amount: number, currency?: string | null) => `${currency}:${amount}`
    );

    render(
      <OrderCard
        order={makeOrder({ source: 'jumia', currency: 'KES' })}
        isSelected={false}
        onSelect={vi.fn()}
        onStatusUpdate={vi.fn()}
        formatCurrency={formatCurrency}
      />
    );

    expect(formatCurrency).toHaveBeenCalledWith(25000, 'KES');
    expect(screen.getByText('KES:25000')).toBeInTheDocument();
  });
});
