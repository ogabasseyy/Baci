import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from './actions';
import { StatusDropdown } from './status-dropdown';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    orderNumber: 'ORD-001',
    customerName: 'Ada Lovelace',
    total: 12000,
    currency: 'NGN',
    shippingStatus: 'Pending',
    paymentStatus: 'Pending',
    paymentMethod: 'card',
    date: 'Mar 23, 2026',
    createdAt: Date.now(),
    source: 'website',
    items: [],
    ...overrides,
  };
}

describe('StatusDropdown', () => {
  it('renders a trigger button for the current shipping status', () => {
    render(<StatusDropdown order={makeOrder()} onStatusUpdate={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /pending/i })
    ).toBeInTheDocument();
  });

  it('calls onStatusUpdate when a new status is selected', async () => {
    const user = userEvent.setup();
    const onStatusUpdate = vi.fn();

    render(
      <StatusDropdown
        order={makeOrder({ shippingStatus: 'Processing' })}
        onStatusUpdate={onStatusUpdate}
      />
    );

    await user.click(screen.getByRole('button', { name: /processing/i }));
    await user.click(screen.getByRole('menuitem', { name: /ship order/i }));

    expect(onStatusUpdate).toHaveBeenCalledWith('ORD-001', 'Shipped');
  });

  it.each([
    'Canceled',
    'Cancelled',
  ] as const)('offers no actions for terminal status %s', async (shippingStatus) => {
    const user = userEvent.setup();

    render(
      <StatusDropdown
        order={makeOrder({ shippingStatus })}
        onStatusUpdate={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button'));
    expect(
      await screen.findByRole('menuitem', { name: /no actions available/i })
    ).toBeInTheDocument();
  });
});
