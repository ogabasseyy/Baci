import { fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { expect, it, vi } from 'vitest';
import type { PaymentMethod, PaymentTab } from '../types';
import { PaymentStep } from './PaymentStep';

const base: ComponentProps<typeof PaymentStep> = {
  currentStep: 'payment',
  completedSteps: { contact: true, delivery: true },
  paymentTab: 'full',
  setPaymentTab: vi.fn(),
  paymentMethod: '',
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
  user: null,
  merchant: { feature_settings: { credit_direct_enabled: true } },
  remainingAmount: 30000,
  orderAmount: 50000,
  redvaultAvailable: false,
  redvaultStatus: 'idle',
  redvaultSummary: null,
  redvaultOrderReady: false,
};

function Checkout({
  initialCredit = true,
  initialTab = 'full',
}: {
  initialCredit?: boolean;
  initialTab?: PaymentTab;
}) {
  const [credit, setCredit] = useState(initialCredit);
  const [tab, setTab] = useState(initialTab);
  const [method, setMethod] = useState<PaymentMethod>('credit_direct');
  return (
    <>
      <output aria-label="Applied wallet credit">
        {credit ? '₦20,000' : '₦0'}
      </output>
      <button type="button" onClick={() => setCredit(true)}>
        Apply wallet credit
      </button>
      <PaymentStep
        {...base}
        paymentTab={tab}
        setPaymentTab={setTab}
        paymentMethod={method}
        setPaymentMethod={setMethod}
        remainingAmount={credit ? 30000 : 50000}
        {...{ payWithWallet: credit, setPayWithWallet: setCredit }}
      />
    </>
  );
}

it('keeps credit applied when switching to instalments and offers Credit Direct for the balance', () => {
  render(<Checkout />);
  fireEvent.click(screen.getByRole('button', { name: /pay small small/i }));
  expect(screen.getByLabelText('Applied wallet credit')).toHaveTextContent(
    '₦20,000'
  );
  expect(
    screen.getByRole('radio', { name: /Credit Direct/i })
  ).toBeInTheDocument();
  expect(
    screen.queryByText(/wallet credit cannot be combined/i)
  ).not.toBeInTheDocument();
});

it('preserves the selected financier when wallet credit arrives later', () => {
  render(<Checkout initialCredit={false} initialTab="installments" />);
  fireEvent.click(screen.getByRole('button', { name: 'Apply wallet credit' }));
  expect(screen.getByLabelText('Applied wallet credit')).toHaveTextContent(
    '₦20,000'
  );
  expect(screen.getByRole('radio', { name: /Credit Direct/i })).toBeChecked();
});

it('does not offer instalments or require a financier when the wallet covers the whole order', () => {
  render(<PaymentStep {...base} remainingAmount={0} />);
  expect(
    screen.queryByRole('button', { name: /pay small small/i })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /place order/i })).toBeEnabled();
});

it.each([
  'oxygen',
] as const)('keeps %s selectable with wallet credit', (paymentMethod) => {
  const setPaymentMethod = vi.fn();
  render(
    <PaymentStep
      {...base}
      oxygenAllowed
      merchant={{ feature_settings: { klump_enabled: true } }}
      paymentTab="installments"
      paymentMethod={paymentMethod}
      setPaymentMethod={setPaymentMethod}
    />
  );
  expect(screen.getByRole('radio', { name: /Oxygen/i })).toBeChecked();
  expect(setPaymentMethod).not.toHaveBeenCalled();
});

it('hides Credit Direct below its minimum while another instalment rail is eligible', () => {
  render(
    <PaymentStep
      {...base}
      oxygenAllowed
      paymentTab="installments"
      remainingAmount={4000}
      orderAmount={4000}
      merchant={{
        feature_settings: { credit_direct_enabled: true, klump_enabled: true },
      }}
    />
  );
  expect(screen.getByRole('radio', { name: /Oxygen/i })).toBeInTheDocument();
  expect(
    screen.queryByRole('radio', { name: /Credit Direct/i })
  ).not.toBeInTheDocument();
});

it('never offers retired Klump even when saved settings still enable it', () => {
  render(
    <PaymentStep
      {...base}
      oxygenAllowed
      paymentTab="installments"
      paymentMethod="klump"
      merchant={{ feature_settings: { klump_enabled: true } }}
    />
  );
  expect(
    screen.queryByRole('radio', { name: /Klump/i })
  ).not.toBeInTheDocument();
});
