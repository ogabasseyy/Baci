import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentTab } from '../types';
import { PaymentOptionsPanel } from './PaymentOptionsPanel';

function renderPanel(
  paymentTab: PaymentTab = 'full',
  gatewayAvailable = true,
  hasInstallmentOptions = true,
  redvault: Partial<ComponentProps<typeof PaymentOptionsPanel>> = {}
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
      redvaultAvailable={false}
      redvaultStatus="idle"
      redvaultSummary={null}
      {...redvault}
    />
  );
  return { setPaymentTab, setPaymentMethod };
}

describe('payment schedule selection', () => {
  it('hides unavailable REDVAULT and allows selecting it when available', () => {
    const hidden = renderPanel();
    expect(
      screen.queryByRole('radio', { name: /pay with uba/i })
    ).not.toBeInTheDocument();
    expect(hidden.setPaymentMethod).not.toHaveBeenCalled();
  });
  it('forwards the REDVAULT selection from the actual panel', () => {
    const { setPaymentMethod } = renderPanel('full', true, false, {
      redvaultAvailable: true,
    });
    fireEvent.click(screen.getByRole('radio', { name: /pay with uba/i }));
    expect(setPaymentMethod).toHaveBeenCalledWith('uba_redvault');
  });
  it.each([
    'error',
    'held',
  ] as const)('displays the %s state through the panel', (redvaultStatus) => {
    renderPanel('full', true, false, {
      paymentMethod: 'uba_redvault',
      redvaultAvailable: true,
      redvaultStatus,
      redvaultSummary: {
        productSubtotalKobo: 11000,
        eligibleSubtotalKobo: 10000,
        ineligibleSubtotalKobo: 1000,
        discountKobo: 500,
        taxKobo: 750,
        shippingKobo: 500,
        giftWrappingKobo: 0,
        payableKobo: 11750,
        mixedBasket: true,
      },
    });
    expect(screen.getByRole('radio', { name: /pay with uba/i })).toBeChecked();
    expect(screen.getByRole('alert')).toHaveTextContent(
      redvaultStatus === 'held' ? /Payment received/ : /could not prepare/
    );
    if (redvaultStatus === 'held')
      expect(
        screen.getByRole('radio', { name: /pay with uba/i })
      ).toBeDisabled();
    expect(screen.getByText('₦117.50')).toBeInTheDocument();
  });

  it.each([
    ['pending', 'status', /awaiting reconciliation/i],
    ['held', 'alert', /Payment received/i],
    ['error', 'alert', /could not prepare/i],
  ] as const)(
    'shows the selected REDVAULT %s state before a quote is available',
    (redvaultStatus, role, message) => {
      renderPanel('full', true, false, {
        paymentMethod: 'uba_redvault',
        redvaultAvailable: true,
        redvaultStatus,
      });

      expect(screen.getByRole(role)).toHaveTextContent(message);
      expect(screen.queryByText(/Total due/)).not.toBeInTheDocument();
    }
  );

  it('hides unavailable installments and restores full payment choices', async () => {
    renderPanel('installments', true, false);
    expect(
      screen.queryByRole('button', { name: 'Pay in Installments' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /generate invoice/i })
    ).toBeInTheDocument();
  });

  describe('bugfix: stale installments tab after wallet makes installments ineligible', () => {
    it('resets the parent payment tab to full without clearing a full-payment method', async () => {
      const { setPaymentTab, setPaymentMethod } = renderPanel(
        'installments',
        true,
        false
      );

      await waitFor(() => {
        expect(setPaymentTab).toHaveBeenCalledWith('full');
      });
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
