import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';
import { RedvaultPaymentChoice } from './RedvaultPaymentChoice';

const summary = {
  eligible: true,
  mixedBasket: false,
  productSubtotalKobo: 150_000_000,
  eligibleSubtotalKobo: 100_000_000,
  discountKobo: 5_000_000,
  taxAmountKobo: 7_500_000,
  shippingFeeKobo: 2_000_000,
  giftWrappingFeeKobo: 500_000,
  payableTotalKobo: 155_000_000,
};

const statusCases: [
  ComponentProps<typeof RedvaultPaymentChoice>['status'],
  string,
][] = [
  ['pending', 'Your UBA payment is being confirmed.'],
  [
    'held',
    'Your payment has been received and is awaiting verification. Do not pay again.',
  ],
  [
    'error',
    'We could not start your UBA payment. Choose another method or try again.',
  ],
];

function renderChoice(
  overrides: Partial<ComponentProps<typeof RedvaultPaymentChoice>> = {}
) {
  const onSelect = jest.fn();
  render(
    <RedvaultPaymentChoice
      available={true}
      selected={false}
      status="idle"
      summary={summary}
      onSelect={onSelect}
      {...overrides}
    />
  );
  return onSelect;
}

describe('RedvaultPaymentChoice', () => {
  it.each([
    19_999_999, 20_000_000, 20_000_001,
  ])('shows both MOU tiers without deriving a discount from eligible subtotal %s', (eligibleSubtotalKobo) => {
    renderChoice({
      summary: {
        ...summary,
        mixedBasket: true,
        eligibleSubtotalKobo,
        discountKobo: 12_345,
        payableTotalKobo: 54_321_000,
      },
    });

    expect(
      screen.getByText(
        '10% off when the eligible pre-discount subtotal is below ₦200,000; 5% at ₦200,000 or more. Excluded products and fees do not count toward this threshold.'
      )
    ).toBeTruthy();
    expect(screen.getByText('-₦123.45')).toBeTruthy();
    expect(screen.getByText('₦543,210.00')).toBeTruthy();
    expect(screen.queryByText('Save 5% on eligible items only.')).toBeNull();
  });

  it('explains the threshold before a server quote exists', () => {
    renderChoice({ summary: undefined });

    expect(
      screen.getByText(/10% off when the eligible pre-discount subtotal/)
    ).toBeTruthy();
    expect(screen.queryByText('-₦50,000.00')).toBeNull();
  });

  it('hides the offer when it is unavailable', () => {
    renderChoice({ available: false });

    expect(screen.queryByRole('radio', { name: 'Pay with UBA' })).toBeNull();
  });

  it('reports selection and invokes the supplied callback', () => {
    const onSelect = renderChoice({ selected: true });

    expect(
      screen.getByRole('radio', { name: 'Pay with UBA' })
    ).toHaveAccessibilityState({ checked: true });
    fireEvent.press(screen.getByRole('radio', { name: 'Pay with UBA' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('displays the server-provided totals without recalculating them', () => {
    renderChoice();

    expect(screen.getByText('₦1,500,000.00')).toBeTruthy();
    expect(screen.getByText('₦1,000,000.00')).toBeTruthy();
    expect(screen.getByText('-₦50,000.00')).toBeTruthy();
    expect(screen.getByText('₦75,000.00')).toBeTruthy();
    expect(screen.getByText('₦20,000.00')).toBeTruthy();
    expect(screen.getByText('₦5,000.00')).toBeTruthy();
    expect(screen.getByText('₦1,550,000.00')).toBeTruthy();
  });

  it('explains a mixed basket without extending the discount to excluded items', () => {
    renderChoice({ summary: { ...summary, mixedBasket: true } });

    expect(
      screen.getByText(/Only eligible items receive the REDVAULT discount/)
    ).toBeTruthy();
  });

  it('disables selection when all basket items are excluded', () => {
    const onSelect = renderChoice({
      summary: {
        ...summary,
        eligible: false,
        eligibleSubtotalKobo: 0,
        discountKobo: 0,
      },
    });

    const choice = screen.getByRole('radio', { name: 'Pay with UBA' });
    expect(choice).toHaveAccessibilityState({ disabled: true });
    expect(
      screen.getByText(
        'This basket has no items eligible for the UBA REDVAULT discount.'
      )
    ).toBeTruthy();
    fireEvent.press(choice);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it.each(
    statusCases
  )('renders the %s payment status without claiming success', (status, message) => {
    renderChoice({ status });

    expect(screen.getByText(message)).toBeTruthy();
  });
});
