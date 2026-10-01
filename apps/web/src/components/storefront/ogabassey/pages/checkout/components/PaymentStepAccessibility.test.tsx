import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PaymentStep } from './PaymentStep';

const defaultProps = {
  currentStep: 'payment' as const,
  focusOnActivate: true,
  completedSteps: { contact: true, delivery: true },
  paymentTab: 'full' as const,
  setPaymentTab: vi.fn(),
  paymentMethod: '' as const,
  setPaymentMethod: vi.fn(),
  isProcessing: false,
  isPayForMeValid: true,
  isDeliveryValid: true,
  payForMeDetails: { name: '', contact: '', note: '' },
  setPayForMeDetails: vi.fn(),
  dva: { isInitializingDva: false },
  newsletterOptIn: false,
  setNewsletterOptIn: vi.fn(),
  handlePlaceOrder: vi.fn(),
  setCurrentStep: vi.fn(),
  merchant: { paystack_subaccount_code: 'ACCT_123' },
  user: null,
  remainingAmount: 10000,
  orderAmount: 10000,
  redvaultAvailable: false,
  redvaultStatus: 'idle' as const,
  redvaultSummary: null,
  redvaultOrderReady: false,
};

it('keeps collapsed payment controls out of the accessibility tree and focuses the opened step', () => {
  const { rerender } = render(
    <PaymentStep {...defaultProps} currentStep="contact" />
  );
  expect(
    screen.queryByRole('radio', { name: /paystack/i })
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: 'Payment Method' })
  ).toHaveAttribute('aria-expanded', 'false');
  rerender(<PaymentStep {...defaultProps} currentStep="payment" />);
  expect(screen.getByRole('radio', { name: /paystack/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Payment Method' })).toHaveFocus();
});
