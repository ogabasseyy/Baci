import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { OrderPaymentSummary } from './OrderPaymentSummary';

vi.mock('@/components/ui/card', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/separator', () => ({
  Separator: () => <hr />,
}));

describe('OrderPaymentSummary', () => {
  it('shows the discount while keeping the persisted net order total', () => {
    render(
      <OrderPaymentSummary
        order={{
          currency: 'NGN',
          discount_amount: 1000,
          paymentMethod: 'card',
          payment_reference: 'pay-123',
          shipping_fee: 500,
          subtotal: 10000,
          tax_amount: 0,
          total: 9500,
        }}
      />
    );

    expect(screen.getByText('Discount')).toBeInTheDocument();
    expect(screen.getByText('-₦1,000')).toBeInTheDocument();
    expect(screen.getByText('₦9,500')).toBeInTheDocument();
  });

  it('does not render an inactive receipt action', () => {
    render(
      <OrderPaymentSummary
        order={{
          currency: 'NGN',
          paymentMethod: null,
          shipping_fee: 0,
          subtotal: 10000,
          tax_amount: 0,
          total: 10000,
        }}
      />
    );

    expect(
      screen.queryByRole('button', { name: /download receipt/i })
    ).not.toBeInTheDocument();
  });

  it('derives a subtotal when older orders do not have one persisted', () => {
    render(
      <OrderPaymentSummary
        order={{
          currency: 'NGN',
          discount_amount: 1000,
          paymentMethod: null,
          shipping_fee: 500,
          tax_amount: 0,
          total: 9500,
        }}
      />
    );

    expect(screen.getByText('₦10,000')).toBeInTheDocument();
  });

  it('does not present inclusive taxes as an additional charge', () => {
    render(
      <OrderPaymentSummary
        order={{
          currency: 'NGN',
          paymentMethod: null,
          shipping_fee: 0,
          subtotal: 10000,
          tax_amount: 750,
          tax_basis: 'inclusive',
          total: 10000,
        }}
      />
    );

    expect(screen.getByText('Taxes (included)')).toBeInTheDocument();
    expect(screen.getByText('Total Amount').parentElement).toHaveTextContent(
      '₦10,000'
    );
  });

  it('labels an unknown tax basis without treating taxes as exclusive', () => {
    render(
      <OrderPaymentSummary
        order={{
          currency: 'NGN',
          paymentMethod: null,
          shipping_fee: 0,
          tax_amount: 750,
          tax_basis: null,
          total: 10000,
        }}
      />
    );

    expect(screen.getByText('Taxes (unclassified)')).toBeInTheDocument();
    expect(screen.getByText('Subtotal').parentElement).toHaveTextContent(
      '₦10,000'
    );
  });

  it('shows gift wrapping as a separate total component', () => {
    render(
      <OrderPaymentSummary
        order={{
          currency: 'NGN',
          gift_wrapping_fee: 500,
          paymentMethod: null,
          shipping_fee: 1000,
          subtotal: 10000,
          tax_amount: 0,
          total: 11500,
        }}
      />
    );

    expect(screen.getByText('Gift Wrapping')).toBeInTheDocument();
    expect(screen.getByText('₦500')).toBeInTheDocument();
  });
});
