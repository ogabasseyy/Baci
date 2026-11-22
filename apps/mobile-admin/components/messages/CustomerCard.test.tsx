import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import type { InboxCustomerProfile } from '@/schemas/merchant-inbox';
import { CustomerCard, customerSummary } from './CustomerCard';

const customer: InboxCustomerProfile = {
  name: 'Ada Obi',
  currency: 'NGN',
  memberSince: '2025-01-02T00:00:00Z',
  orderCount: 5,
  totalSpent: 412000,
  loyaltyPoints: 120,
  recentOrders: [
    {
      orderNumber: 'ORD-1',
      total: 50000,
      currency: 'NGN',
      paymentStatus: 'paid',
      shippingStatus: 'shipped',
      createdAt: '2026-11-20T10:00:00Z',
    },
    {
      orderNumber: 'ORD-0',
      total: 12000,
      currency: 'NGN',
      paymentStatus: 'pending',
      shippingStatus: 'processing',
      createdAt: null,
    },
  ],
};

describe('customerSummary', () => {
  it('shows order count and spend for a returning customer', () => {
    const text = customerSummary(customer);
    expect(text).toContain('Returning customer · 5 orders');
    expect(text).toMatch(/412,000/);
  });

  it('says one order in the singular and handles no orders', () => {
    expect(customerSummary({ ...customer, orderCount: 1 })).toContain(
      '1 order ·'
    );
    expect(customerSummary({ ...customer, orderCount: 0 })).toBe(
      'Signed-in customer · no orders yet'
    );
  });
});

describe('CustomerCard', () => {
  it('shows the name, summary and the last order while collapsed', () => {
    render(<CustomerCard colors={LIGHT_COLORS} customer={customer} />);
    expect(screen.getByText('Ada Obi')).toBeInTheDocument();
    expect(
      screen.getByText(/Returning customer · 5 orders/)
    ).toBeInTheDocument();
    expect(screen.getByText('Last order ORD-1 · Shipped')).toBeInTheDocument();
    expect(screen.queryByText('ORD-0')).toBeNull();
  });

  it('opens to list the recent orders and closes again', () => {
    render(<CustomerCard colors={LIGHT_COLORS} customer={customer} />);
    const header = screen.getByRole('button', { name: /Ada Obi/ });

    fireEvent.click(header);
    expect(screen.getByText('ORD-0')).toBeInTheDocument();
    expect(screen.getByText(/Pending · Processing/)).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.queryByText('ORD-0')).toBeNull();
  });

  it('is not expandable when the customer has no orders yet', () => {
    render(
      <CustomerCard
        colors={LIGHT_COLORS}
        customer={{ ...customer, orderCount: 0, recentOrders: [] }}
      />
    );
    expect(screen.getByRole('button', { name: /Ada Obi/ })).toBeDisabled();
    expect(
      screen.getByText('Signed-in customer · no orders yet')
    ).toBeInTheDocument();
  });

  it('bugfix: shows amounts in the currency they were charged in, not naira', () => {
    const dollars: InboxCustomerProfile = {
      ...customer,
      currency: 'USD',
      totalSpent: 1500,
      recentOrders: [
        { ...customer.recentOrders[0], total: 40, currency: 'GBP' },
        { ...customer.recentOrders[1], total: 25, currency: 'USD' },
      ],
    };
    render(<CustomerCard colors={LIGHT_COLORS} customer={dollars} />);

    expect(
      screen.getByText(/Returning customer · 5 orders · \$1,500/)
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ada Obi/ }));
    expect(screen.getByText('£40')).toBeInTheDocument();
    expect(screen.getByText('$25')).toBeInTheDocument();
    expect(screen.queryByText(/₦/)).toBeNull();
  });

  it('does not offer to expand when order details are not available to this user', () => {
    render(
      <CustomerCard
        colors={LIGHT_COLORS}
        customer={{ ...customer, recentOrders: [] }}
      />
    );
    expect(screen.getByRole('button', { name: /Ada Obi/ })).toBeDisabled();
    expect(
      screen.getByText(/Returning customer · 5 orders/)
    ).toBeInTheDocument();
  });
});
