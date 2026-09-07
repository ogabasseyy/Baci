import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentTab } from '../types';
import { PaymentOptionsPanel } from './PaymentOptionsPanel';

function renderPanel(
  paymentTab: PaymentTab = 'full',
  gatewayAvailable = true,
  hasInstallmentOptions = true
) {
  const setPaymentTab = vi.fn();
  const setPaymentMethod = vi.fn();
  render(
    <PaymentOptionsPanel
      paymentTab={paymentTab}
      setPaymentTab={setPaymentTab}
      paymentMethod="paystack"
      setPaymentMethod={setPaymentMethod}
      paystackCheckoutAvailable={gatewayAvailable}
      korapayCheckoutAvailable={false}
      bankTransferCheckoutAvailable={false}
      klumpEligible={false}
      hasInstallmentOptions={hasInstallmentOptions}
      currency="NGN"
    />
  );
  return { setPaymentTab, setPaymentMethod };
}

describe('payment schedule selection', () => {
  it('hides unavailable installments and restores full payment choices', () => {
    renderPanel('installments', true, false);
    expect(
      screen.queryByRole('button', { name: 'Pay in Installments' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /generate invoice/i })
    ).toBeInTheDocument();
  });

  describe('bugfix: stale installments tab after wallet makes installments ineligible', () => {
    it('resets the parent payment tab to full without clearing a full-payment method', () => {
      const { setPaymentTab, setPaymentMethod } = renderPanel(
        'installments',
        true,
        false
      );

      expect(setPaymentTab).toHaveBeenCalledWith('full');
      expect(setPaymentMethod).not.toHaveBeenCalled();
      expect(
        screen.getByRole('radio', { name: /generate invoice/i })
      ).toBeInTheDocument();
    });
  });
  it('offers invoice creation without requiring an online payment gateway', () => {
    const { setPaymentMethod } = renderPanel('full', false);

    fireEvent.click(screen.getByRole('radio', { name: /generate invoice/i }));

    expect(setPaymentMethod).toHaveBeenCalledWith('invoice');
  });

  it('keeps invoice creation out of installment financing options', () => {
    renderPanel('installments');

    expect(
      screen.queryByRole('radio', { name: /generate invoice/i })
    ).not.toBeInTheDocument();
  });

  it.each([
    ['full', 'Pay in Full', 'Pay in Installments'],
    ['installments', 'Pay in Installments', 'Pay in Full'],
  ] as const)('keeps the %s selection distinct when dark mode flattens neutral surfaces', (value, selected, inactive) => {
    renderPanel(value);

    expect(
      screen.getByRole('group', { name: 'Payment schedule' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: selected })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: selected })).toHaveClass(
      'bg-store-primary',
      'text-store-primary-text'
    );
    expect(screen.getByRole('button', { name: inactive })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(screen.getByRole('button', { name: inactive })).not.toHaveClass(
      'bg-store-primary'
    );
  });

  it.each([
    ['full', 'Pay in Installments', 'installments'],
    ['installments', 'Pay in Full', 'full'],
  ] as const)('switches away from %s and clears the old gateway', (value, label, next) => {
    const { setPaymentTab, setPaymentMethod } = renderPanel(value);

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(setPaymentTab).toHaveBeenCalledWith(next);
    expect(setPaymentMethod).toHaveBeenCalledWith('');
  });
});
