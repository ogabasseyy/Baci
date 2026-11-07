import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PaymentStep } from './PaymentStep';

it.each([49630.5, 0])('offers instalments with wallet credit and removes the credit when selected (remaining %s)', (remainingAmount) => {
  const setPayWithWallet = vi.fn();
  render(<PaymentStep currentStep="payment" completedSteps={{ contact: true, delivery: true }}
    paymentTab="full" setPaymentTab={vi.fn()} paymentMethod="" setPaymentMethod={vi.fn()}
    isProcessing={false} isPayForMeValid isDeliveryValid payForMeDetails={{ name: '', contact: '', note: '' }}
    setPayForMeDetails={vi.fn()} dva={{ isInitializingDva: false }} newsletterOptIn={false}
    setNewsletterOptIn={vi.fn()} handlePlaceOrder={vi.fn()} setCurrentStep={vi.fn()}
    merchant={{ feature_settings: { credit_direct_enabled: true } }} user={null}
    remainingAmount={remainingAmount} orderAmount={50000} payWithWallet setPayWithWallet={setPayWithWallet}
    redvaultAvailable={false} redvaultStatus="idle" redvaultSummary={null} redvaultOrderReady={false} />);
  fireEvent.click(screen.getByRole('button', { name: /pay in installments/i }));
  expect(setPayWithWallet).toHaveBeenCalledWith(false);
});

it('removes wallet credit that arrives after instalments were selected', () => {
  const setPayWithWallet = vi.fn();
  render(<PaymentStep currentStep="payment" completedSteps={{ contact: true, delivery: true }}
    paymentTab="installments" setPaymentTab={vi.fn()} paymentMethod="" setPaymentMethod={vi.fn()}
    isProcessing={false} isPayForMeValid isDeliveryValid payForMeDetails={{ name: '', contact: '', note: '' }}
    setPayForMeDetails={vi.fn()} dva={{ isInitializingDva: false }} newsletterOptIn={false}
    setNewsletterOptIn={vi.fn()} handlePlaceOrder={vi.fn()} setCurrentStep={vi.fn()}
    merchant={{ feature_settings: { credit_direct_enabled: true } }} user={null}
    remainingAmount={49630.5} orderAmount={50000} payWithWallet setPayWithWallet={setPayWithWallet}
    redvaultAvailable={false} redvaultStatus="idle" redvaultSummary={null} redvaultOrderReady={false} />);
  expect(setPayWithWallet).toHaveBeenCalledWith(false);
});
