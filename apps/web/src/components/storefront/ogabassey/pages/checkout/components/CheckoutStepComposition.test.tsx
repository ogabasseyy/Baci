import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutDeliveryStep } from './CheckoutDeliveryStep';
import { CheckoutStepComposition } from './CheckoutStepComposition';
import type { ContactStep } from './ContactStep';
import type { PaymentStep } from './PaymentStep';

vi.mock('./ContactStep', () => ({
  ContactStep: ({ active, completed }: ComponentProps<typeof ContactStep>) => (
    <section
      aria-current={active ? 'step' : undefined}
      aria-label="Contact details"
    >
      {completed ? 'Contact details complete' : 'Contact details incomplete'}
    </section>
  ),
}));

vi.mock('./CheckoutDeliveryStep', () => ({
  CheckoutDeliveryStep: ({
    active,
    completed,
    disabled,
  }: ComponentProps<typeof CheckoutDeliveryStep>) => (
    <section
      aria-current={active ? 'step' : undefined}
      aria-label="Delivery details"
    >
      {completed ? 'Delivery details complete' : 'Delivery details incomplete'}
      <button type="button" disabled={disabled}>
        Delivery Method
      </button>
    </section>
  ),
}));

vi.mock('./PaymentStep', () => ({
  PaymentStep: ({ currentStep }: ComponentProps<typeof PaymentStep>) => (
    <section aria-label="Payment">Current checkout step: {currentStep}</section>
  ),
}));

const emptyContactProps = {
  values: {
    firstName: '',
    lastName: '',
    customerEmail: '',
    customerPhone: '',
  },
  onChange: vi.fn(),
  account: { createAccount: false, password: '' },
  onAccountChange: vi.fn(),
  onOpen: vi.fn(),
  onComplete: vi.fn(),
} satisfies Omit<
  ComponentProps<typeof ContactStep>,
  'active' | 'completed' | 'focusOnActivate' | 'signedIn'
>;

const emptyDeliveryProps = {
  addressFields: {
    signedIn: false,
    addresses: [],
    isNewAddressMode: true,
    selectedAddressId: null,
    newAddressStreet: '',
    newAddressCity: '',
    newAddressState: '',
    merchantCountry: 'NG',
    addressReady: false,
    onToggleAddressMode: vi.fn(),
    onSelectAddress: vi.fn(),
    onStreetChange: vi.fn(),
    onSelectPlace: vi.fn(),
  },
  deliveryOptions: null,
  isDeliveryValid: false,
  onContinue: vi.fn(),
  onOpen: vi.fn(),
  summary: '',
} satisfies Omit<
  ComponentProps<typeof CheckoutDeliveryStep>,
  'active' | 'completed' | 'disabled' | 'focusOnActivate'
>;

const emptyPaymentProps = {
  paymentTab: 'full',
  setPaymentTab: vi.fn(),
  paymentMethod: '',
  setPaymentMethod: vi.fn(),
  isProcessing: false,
  isPayForMeValid: false,
  isDeliveryValid: false,
  payForMeDetails: { name: '', contact: '', note: '' },
  setPayForMeDetails: vi.fn(),
  dva: { isInitializingDva: false },
  newsletterOptIn: false,
  setNewsletterOptIn: vi.fn(),
  handlePlaceOrder: vi.fn(),
  setCurrentStep: vi.fn(),
  merchant: null,
  user: null,
  remainingAmount: 0,
  orderAmount: 0,
  redvaultAvailable: false,
  redvaultStatus: 'idle',
  redvaultSummary: null,
  redvaultOrderReady: false,
} satisfies Omit<
  ComponentProps<typeof PaymentStep>,
  'completedSteps' | 'currentStep' | 'focusOnActivate'
>;

describe('CheckoutStepComposition', () => {
  it('orders the panels and gates sign-in and delivery from checkout flow state', () => {
    const onSignIn = vi.fn();
    const { rerender } = render(
      <CheckoutStepComposition
        flow={{
          currentStep: 'contact',
          completedSteps: { contact: false, delivery: false },
          focusOnActivate: false,
          signedIn: false,
        }}
        onSignIn={onSignIn}
        contact={emptyContactProps}
        delivery={emptyDeliveryProps}
        payment={emptyPaymentProps}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Already have an account?' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(onSignIn).toHaveBeenCalledOnce();

    const panelOrder = screen
      .getAllByRole('region')
      .map((panel) => panel.getAttribute('aria-label'));
    expect(panelOrder).toEqual([
      'Contact details',
      'Delivery details',
      'Payment',
    ]);
    expect(
      screen.getByRole('region', { name: 'Contact details' })
    ).toHaveAttribute('aria-current', 'step');
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toBeDisabled();

    rerender(
      <CheckoutStepComposition
        flow={{
          currentStep: 'delivery',
          completedSteps: { contact: true, delivery: false },
          focusOnActivate: true,
          signedIn: true,
        }}
        onSignIn={onSignIn}
        contact={emptyContactProps}
        delivery={emptyDeliveryProps}
        payment={emptyPaymentProps}
      />
    );

    expect(
      screen.queryByRole('heading', { name: 'Already have an account?' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Contact details' })
    ).toHaveTextContent('Contact details complete');
    expect(
      screen.getByRole('region', { name: 'Delivery details' })
    ).toHaveAttribute('aria-current', 'step');
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toBeEnabled();
    expect(
      screen.getByText('Current checkout step: delivery')
    ).toBeInTheDocument();
  });
});
