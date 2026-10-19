import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CustomerSavingsStatus } from './customer-savings-status';
import type { CustomerSavingsStatusProps } from './customer-savings-status.types';

const device = {
  productName: 'Synthetic Phone',
  variant: '256 GB / Forest green',
  condition: 'Used — excellent',
};

function readyProps(): Extract<
  CustomerSavingsStatusProps,
  { status: 'ready' }
> {
  return {
    status: 'ready',
    device,
    decision: {
      purchasingPowerKobo: 123456,
      devicePriceKobo: 120000,
      readiness: 'ready_for_review',
      purchaseAction: 'requires_customer_confirmation',
    },
    pendingInterestKobo: 789,
    actionPending: false,
    onReviewPurchase: vi.fn(),
  };
}

describe('CustomerSavingsStatus', () => {
  it('omits the variant row for an exact product without variants', () => {
    render(
      <CustomerSavingsStatus
        {...readyProps()}
        device={{ ...device, variant: null }}
      />
    );
    expect(screen.getByText(device.productName)).toBeVisible();
    expect(screen.queryByText('Variant')).not.toBeInTheDocument();
  });

  it('preserves every kobo at the safe integer boundary', () => {
    render(
      <CustomerSavingsStatus
        {...readyProps()}
        pendingInterestKobo={Number.MAX_SAFE_INTEGER}
      />
    );

    expect(screen.getByText('₦90,071,992,547,409.91')).toBeVisible();
  });

  it('removes stale balances and review when the server view becomes unavailable', () => {
    const props = readyProps();
    const { rerender } = render(<CustomerSavingsStatus {...props} />);

    rerender(<CustomerSavingsStatus status="unavailable" device={device} />);

    expect(screen.queryByText('₦1,234.56')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(props.onReviewPurchase).not.toHaveBeenCalled();
  });

  it.each([
    ['loading', 'Loading savings status…'],
    ['unavailable', 'Savings status is unavailable. Please try again later.'],
    ['pending_wallet', 'Your savings wallet is pending confirmation.'],
  ] as const)('shows %s without a balance or action', (status, message) => {
    render(<CustomerSavingsStatus status={status} device={device} />);

    expect(screen.getByRole('status')).toHaveTextContent(message);
    expect(screen.queryByText('Server-confirmed purchasing power')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText(device.variant)).toBeVisible();
  });

  it('shows the exact descriptor, staging label and separate internal ledger amounts', () => {
    render(<CustomerSavingsStatus {...readyProps()} />);

    expect(
      screen.getByRole('region', { name: 'Customer savings' })
    ).toBeVisible();
    expect(screen.getByText('Staging')).toBeVisible();
    expect(screen.getByText(device.productName)).toBeVisible();
    expect(screen.getByText(device.variant)).toBeVisible();
    expect(screen.getByText(device.condition)).toBeVisible();
    expect(screen.getByText('Server-confirmed purchasing power')).toBeVisible();
    expect(screen.getByText('₦1,234.56')).toBeVisible();
    expect(screen.getByText('₦1,200.00')).toBeVisible();
    expect(screen.getByText('₦7.89')).toBeVisible();
    expect(screen.getByText('Pending interest — not spendable')).toBeVisible();
    expect(
      screen.getByText('Pending interest is excluded from purchasing power.')
    ).toBeVisible();
    expect(screen.queryByText(/guarantee|gift|stock reserved|%/i)).toBeNull();
    expect(
      screen.queryByRole('button', { name: /withdraw|refund|cancel/i })
    ).toBeNull();
  });

  it('calls review only after a customer click and passes no identifiers', () => {
    const props = readyProps();
    render(<CustomerSavingsStatus {...props} />);

    expect(props.onReviewPurchase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review purchase' }));
    expect(props.onReviewPurchase).toHaveBeenCalledExactlyOnceWith();
  });

  it('disables review during a pending action', () => {
    const props = readyProps();
    render(<CustomerSavingsStatus {...props} actionPending />);

    const button = screen.getByRole('button', { name: 'Review purchase' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(props.onReviewPurchase).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'An action is pending.'
    );
  });

  it.each([
    'blocked',
    'not_available',
  ] as const)('honors %s even when the amount and readiness suggest a purchase', (purchaseAction) => {
    const props = readyProps();
    render(
      <CustomerSavingsStatus
        {...props}
        decision={{ ...props.decision, purchaseAction }}
      />
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.getByText('Purchase review is currently unavailable.')
    ).toBeVisible();
    expect(props.onReviewPurchase).not.toHaveBeenCalled();
  });

  it.each([
    ['continue_saving', 'Continue saving.'],
    ['review_required', 'Your savings need review.'],
    ['not_available', 'Savings readiness is unavailable.'],
  ] as const)('displays server readiness %s', (readiness, message) => {
    const props = readyProps();
    render(
      <CustomerSavingsStatus
        {...props}
        decision={{ ...props.decision, readiness, purchaseAction: 'blocked' }}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent(message);
  });

  it('does not invent pending interest when it is unavailable', () => {
    render(
      <CustomerSavingsStatus {...readyProps()} pendingInterestKobo={null} />
    );

    expect(screen.getByText('Pending interest unavailable')).toBeVisible();
    expect(screen.queryByText('₦0.00')).toBeNull();
  });

  it('renders zero kobo without treating it as unavailable', () => {
    const props = readyProps();
    render(
      <CustomerSavingsStatus
        {...props}
        pendingInterestKobo={0}
        decision={{
          ...props.decision,
          purchasingPowerKobo: 0,
          purchaseAction: 'blocked',
        }}
      />
    );

    expect(screen.getAllByText('₦0.00')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('fails closed for invalid internal kobo amount %s', (amount) => {
    const props = readyProps();
    const { rerender } = render(
      <CustomerSavingsStatus {...props} pendingInterestKobo={amount} />
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Savings status is unavailable.'
    );
    expect(screen.queryByRole('button')).toBeNull();

    for (const field of ['purchasingPowerKobo', 'devicePriceKobo'] as const) {
      rerender(
        <CustomerSavingsStatus
          {...props}
          decision={{ ...props.decision, [field]: amount }}
        />
      );
      expect(screen.getByRole('status')).toHaveTextContent(
        'Savings status is unavailable.'
      );
      expect(screen.queryByRole('button')).toBeNull();
    }
    expect(props.onReviewPurchase).not.toHaveBeenCalled();
  });
});
