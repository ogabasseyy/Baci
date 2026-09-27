import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { StorefrontTransaction } from '@/types/storefront-order';
import { CustomerOrderPaymentHistory } from './customer-order-payment-history';

function transaction(overrides: Partial<StorefrontTransaction> = {}) {
  return {
    id: 'txn-1',
    amount: 100000,
    created_at: '2026-03-22T10:00:00.000Z',
    description: 'Card payment',
    metadata: { payment_method: 'card' },
    ...overrides,
  };
}

describe('CustomerOrderPaymentHistory', () => {
  it('renders nothing without transactions', () => {
    const { container: empty } = render(
      <CustomerOrderPaymentHistory transactions={[]} currency="NGN" />
    );
    const { container: missing } = render(
      <CustomerOrderPaymentHistory transactions={undefined} currency="NGN" />
    );

    expect(empty).toBeEmptyDOMElement();
    expect(missing).toBeEmptyDOMElement();
  });

  it('lists each transaction with its amount and date', () => {
    render(
      <CustomerOrderPaymentHistory
        transactions={[
          transaction(),
          transaction({
            id: 'txn-2',
            amount: 5000,
            description: 'Wallet top-up',
            metadata: null,
          }),
        ]}
        currency="NGN"
      />
    );

    expect(screen.getByText('Payment History')).toBeInTheDocument();
    expect(screen.getByText('card')).toBeInTheDocument();
    expect(screen.getByText('Wallet top-up')).toBeInTheDocument();
    expect(screen.getAllByText('3/22/2026')).toHaveLength(2);
  });

  it('falls back to the generic label without method or description', () => {
    render(
      <CustomerOrderPaymentHistory
        transactions={[transaction({ description: null, metadata: null })]}
        currency="NGN"
      />
    );

    expect(screen.getByText('Payment')).toBeInTheDocument();
  });
});
