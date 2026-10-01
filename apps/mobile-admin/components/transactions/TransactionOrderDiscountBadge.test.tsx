import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LIGHT_COLORS } from '@/constants/theme';
import { TransactionOrderDiscountBadge } from './TransactionOrderDiscountBadge';

vi.mock('react-native', () => ({
  Text: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
}));

vi.mock('@/components/transactions/transactions.styles', () => ({
  styles: { orderDetailText: {} },
}));

describe('TransactionOrderDiscountBadge', () => {
  it('renders a positive order discount', () => {
    render(
      <TransactionOrderDiscountBadge
        colors={LIGHT_COLORS}
        discountAmount={1250}
        formatCurrency={(amount) => `NGN ${amount}`}
      />
    );

    expect(screen.getByText('Discount -NGN 1250')).toBeInTheDocument();
  });

  it('does not render when there is no discount', () => {
    const { container } = render(
      <TransactionOrderDiscountBadge
        colors={LIGHT_COLORS}
        discountAmount={0}
        formatCurrency={(amount) => `NGN ${amount}`}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });
});
