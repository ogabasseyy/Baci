import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PaymentStep } from './PaymentStep';
import { hasAnyInstallmentOption, isPaymentMethodAvailable } from './payment-step-availability';

afterEach(() => vi.unstubAllEnvs());
it('offers Oxygen to an admitted production pilot and hides it after admission is removed', () => {
  vi.stubEnv('NODE_ENV', 'production');
  const props = {
    currentStep: 'payment' as const, completedSteps: { contact: true, delivery: true },
    paymentTab: 'installments' as const, setPaymentTab: vi.fn(), paymentMethod: '' as const,
    setPaymentMethod: vi.fn(), isProcessing: false, isPayForMeValid: true, isDeliveryValid: true,
    payForMeDetails: { name: '', contact: '', note: '' }, setPayForMeDetails: vi.fn(),
    dva: { isInitializingDva: false }, newsletterOptIn: false, setNewsletterOptIn: vi.fn(),
    handlePlaceOrder: vi.fn(), setCurrentStep: vi.fn(), merchant: {}, user: null,
    remainingAmount: 10000, orderAmount: 10000, redvaultAvailable: false,
    redvaultStatus: 'idle' as const, redvaultSummary: null, redvaultOrderReady: false,
  };
  const view = render(<PaymentStep {...props} oxygenAllowed />);
  expect(screen.getByRole('radio', { name: /oxygen/i })).toBeVisible();
  view.rerender(<PaymentStep {...props} oxygenAllowed={false} />);
  expect(screen.queryByRole('radio', { name: /oxygen/i })).toBeNull();
});
it('offers an admitted pilot for a positive NGN balance', () => {
  const base = { paymentMethod: 'oxygen' as const, paystackCheckoutAvailable: false,
    korapayCheckoutAvailable: false, bankTransferCheckoutAvailable: false,
    currency: 'NGN', orderAmount: 50000, payableAmount: 50000 };
  expect(isPaymentMethodAvailable({ ...base, oxygenAllowed: true })).toBe(true);
  expect(isPaymentMethodAvailable({ ...base, oxygenAllowed: false })).toBe(false);
  expect(isPaymentMethodAvailable({ ...base, oxygenAllowed: true, payableAmount: 40000 })).toBe(true);
  expect(isPaymentMethodAvailable({ ...base, oxygenAllowed: true, payableAmount: 0 })).toBe(false);
  expect(hasAnyInstallmentOption({ ...base, oxygenAllowed: true })).toBe(true);
});
