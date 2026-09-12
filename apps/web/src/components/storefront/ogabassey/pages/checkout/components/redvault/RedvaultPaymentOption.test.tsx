import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RedvaultPaymentOption } from './RedvaultPaymentOption';

const mixedBasketSummary = {
  productSubtotalKobo: 15_000_000,
  eligibleSubtotalKobo: 10_000_000,
  discountKobo: 500_000,
  assuranceFeeKobo: 0,
  ineligibleSubtotalKobo: 5_000_000,
  taxKobo: 1_125_000,
  shippingKobo: 300_000,
  giftWrappingKobo: 50_000,
  payableKobo: 15_975_000,
  mixedBasket: true,
};

type RenderOptionProps = {
  available?: boolean;
  selected?: boolean;
  status?: 'idle' | 'pending' | 'held' | 'error';
  summary?: typeof mixedBasketSummary | null;
  onSelect?: () => void;
};

function renderOption({
  available = true,
  selected = false,
  status = 'idle',
  summary = mixedBasketSummary,
  onSelect = vi.fn(),
}: RenderOptionProps = {}) {
  return render(
    <RedvaultPaymentOption
      available={available}
      onSelect={onSelect}
      selected={selected}
      status={status}
      summary={summary}
    />
  );
}

describe('RedvaultPaymentOption', () => {
  it.each([
    19_999_999, 20_000_000, 20_000_001,
  ])('shows both MOU tiers without deriving a discount from eligible subtotal %s', (eligibleSubtotalKobo) => {
    renderOption({
      selected: true,
      summary: {
        ...mixedBasketSummary,
        eligibleSubtotalKobo,
        productSubtotalKobo: 50_000_000,
        discountKobo: 12_345,
        payableKobo: 54_321_000,
      },
    });

    expect(
      screen.getByText(
        '10% off when the eligible pre-discount subtotal is below ₦200,000; 5% at ₦200,000 or more. Excluded products and fees do not count toward this threshold.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('-₦123.45')).toBeInTheDocument();
    expect(screen.getByText('₦543,210.00')).toBeInTheDocument();
    expect(screen.queryByText('5% off eligible items')).toBeNull();
  });

  it('explains the threshold before a server quote exists', () => {
    renderOption({ summary: null });

    expect(
      screen.getByText(/10% off when the eligible pre-discount subtotal/)
    ).toBeInTheDocument();
    expect(screen.queryByText('UBA REDVAULT savings')).toBeNull();
  });

  it('hides the payment option when REDVAULT is unavailable', () => {
    renderOption({ available: false });

    expect(
      screen.queryByRole('radio', { name: /pay with uba/i })
    ).not.toBeInTheDocument();
  });

  it('lets keyboard and pointer users select Pay with UBA', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();

    renderOption({ onSelect });

    const paymentOption = screen.getByRole('radio', { name: /pay with uba/i });
    await user.tab();
    expect(paymentOption).toHaveFocus();
    await user.keyboard(' ');

    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('displays the server-provided REDVAULT quote without recalculating it', () => {
    renderOption({ selected: true });

    expect(
      screen.getByText('Your savings are included in the total below.')
    ).toBeInTheDocument();
    expect(screen.getByText('₦150,000.00')).toBeInTheDocument();
    expect(screen.getByText('₦100,000.00')).toBeInTheDocument();
    expect(screen.getByText('-₦5,000.00')).toBeInTheDocument();
    expect(screen.getByText('₦159,750.00')).toBeInTheDocument();
  });

  it('permits selection before the server has returned a quote', () => {
    renderOption({
      summary: null,
    });

    expect(
      screen.getByText('Savings are confirmed after we validate your order.')
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /pay with uba/i })
    ).not.toBeDisabled();
  });

  it.each([
    [
      'pending',
      'Payment setup is awaiting reconciliation. Your order is not yet paid.',
      'status',
    ],
    [
      'held',
      'Payment received; your order is awaiting verification. Please do not pay again.',
      'alert',
    ],
    [
      'error',
      'We could not prepare Pay with UBA. Choose another payment method or try again.',
      'alert',
    ],
  ] as const)('communicates the %s payment state', (status, message, role) => {
    renderOption({ selected: true, status });

    expect(screen.getByRole(role)).toHaveTextContent(message);
  });
});
