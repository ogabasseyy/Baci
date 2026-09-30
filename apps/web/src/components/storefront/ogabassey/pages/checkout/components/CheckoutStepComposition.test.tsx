import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import type { useCheckoutDeliverySession } from '../hooks/use-checkout-delivery-session';
import type { useCheckoutPaymentSession } from '../hooks/use-checkout-payment-session';
import type { CheckoutDeliveryStep } from './CheckoutDeliveryStep';
import type { CheckoutStepCompositionSession } from './CheckoutStepComposition';
import { CheckoutStepComposition } from './CheckoutStepComposition';
import type { ContactStep } from './ContactStep';
import type { PaymentStep } from './PaymentStep';

vi.mock('@/lib/posthog/capture-client-event', () => ({
  captureClientEvent: vi.fn(),
}));

vi.mock('./ContactStep', () => ({
  ContactStep: ({
    active,
    completed,
    onAccountChange,
  }: ComponentProps<typeof ContactStep>) => (
    <section
      aria-current={active ? 'step' : undefined}
      aria-label="Contact details"
    >
      {completed ? 'Contact details complete' : 'Contact details incomplete'}
      <button
        type="button"
        onClick={() =>
          onAccountChange({ createAccount: true, password: 'secret-123' })
        }
      >
        Enable account creation
      </button>
    </section>
  ),
}));

vi.mock('./CheckoutDeliveryStep', () => ({
  CheckoutDeliveryStep: ({
    active,
    completed,
    disabled,
    isDeliveryValid,
    onContinue,
  }: ComponentProps<typeof CheckoutDeliveryStep>) => (
    <section
      aria-current={active ? 'step' : undefined}
      aria-label="Delivery details"
    >
      {completed ? 'Delivery details complete' : 'Delivery details incomplete'}
      <button type="button" disabled={disabled}>
        Delivery Method
      </button>
      <button type="button" disabled={!isDeliveryValid} onClick={onContinue}>
        Continue to Payment
      </button>
    </section>
  ),
}));

vi.mock('./PaymentStep', () => ({
  PaymentStep: ({
    currentStep,
    newsletterOptIn,
    setNewsletterOptIn,
    redvaultAvailable,
    redvaultOrderReady,
    setCurrentStep,
  }: ComponentProps<typeof PaymentStep>) => (
    <section aria-label="Payment">
      Current checkout step: {currentStep}
      <span>Newsletter opt-in: {newsletterOptIn ? 'on' : 'off'}</span>
      <span>
        Redvault: {redvaultAvailable ? 'available' : 'unavailable'} /{' '}
        {redvaultOrderReady ? 'ready' : 'waiting'}
      </span>
      <button
        type="button"
        onClick={() => setNewsletterOptIn(!newsletterOptIn)}
      >
        Toggle newsletter
      </button>
      <button type="button" onClick={() => setCurrentStep('delivery')}>
        Return to delivery
      </button>
    </section>
  ),
}));

function createSession(isDeliveryValid = false) {
  const setCurrentStep = vi.fn();
  const setCompletedSteps = vi.fn();
  const setCreateAccount = vi.fn();
  const setPassword = vi.fn();
  const setNewsletterOptIn = vi.fn();
  const session = {
    flow: {
      currentStep: 'contact',
      completedSteps: { contact: true, delivery: false },
      focusOnActivate: false,
      signedIn: false,
      setCurrentStep,
      setCompletedSteps,
    },
    onSignIn: vi.fn(),
    contact: {
      values: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        customerEmail: 'ada@example.test',
        customerPhone: '+2348000000000',
      },
      onChange: vi.fn(),
      onComplete: vi.fn(),
      account: {
        createAccount: false,
        password: '',
        setCreateAccount,
        setPassword,
      },
    },
    delivery: {
      session: {
        address: {
          addresses: [],
          selectedId: null,
          isNewMode: true,
          setIsNewMode: vi.fn(),
          isNewDeliveryAddressReady: true,
          handlers: {
            onSelectAddress: vi.fn(),
            onStreetChange: vi.fn(),
            onSelectPlace: vi.fn(),
          },
        },
        method: { selected: 'door' },
        options: null,
        validation: { isValid: isDeliveryValid },
      } as unknown as ReturnType<typeof useCheckoutDeliverySession>,
      address: {
        street: '1 Main Street',
        city: 'Lagos',
        state: 'Lagos',
        merchantCountry: 'NG',
        isHydrated: true,
      },
    },
    payment: {
      session: {
        tab: 'full',
        method: 'paystack',
        setTab: vi.fn(),
        selectMethod: vi.fn(),
        payForMe: {
          isValid: false,
          details: { name: '', contact: '', note: '' },
          setDetails: vi.fn(),
        },
        wallet: { remainingAmount: 1_000 },
        total: 1_000,
        redvault: {
          status: 'idle',
          summary: null,
        },
      } as unknown as ReturnType<typeof useCheckoutPaymentSession>,
      isProcessing: false,
      isPayForMeValid: false,
      isInitializingDva: false,
      newsletterOptIn: false,
      setNewsletterOptIn,
      handlePlaceOrder: vi.fn(),
      merchant: null,
      user: null,
      currency: 'NGN',
      redvaultAvailable: true,
      redvaultOrderReady: false,
    },
  } satisfies CheckoutStepCompositionSession;

  return {
    session,
    setCurrentStep,
    setCompletedSteps,
    setCreateAccount,
    setPassword,
    setNewsletterOptIn,
  };
}

describe('CheckoutStepComposition', () => {
  it('composes ordered steps, sign-in, account, newsletter, and Redvault session state', () => {
    const model = createSession();
    render(<CheckoutStepComposition session={model.session} />);

    expect(
      screen.getByRole('heading', { name: 'Already have an account?' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(model.session.onSignIn).toHaveBeenCalledOnce();

    fireEvent.click(
      screen.getByRole('button', { name: 'Enable account creation' })
    );
    expect(model.setCreateAccount).toHaveBeenCalledWith(true);
    expect(model.setPassword).toHaveBeenCalledWith('secret-123');

    expect(
      screen
        .getAllByRole('region')
        .map((panel) => panel.getAttribute('aria-label'))
    ).toEqual(['Contact details', 'Delivery details', 'Payment']);
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Continue to Payment' })
    ).toBeDisabled();
    expect(
      screen.getByText('Redvault: available / waiting')
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle newsletter' }));
    expect(model.setNewsletterOptIn).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Return to delivery' }));
    expect(model.setCurrentStep).toHaveBeenCalledWith('delivery');
  });

  it('captures delivery completion and advances only after validation passes', () => {
    const model = createSession();
    const { rerender } = render(
      <CheckoutStepComposition session={model.session} />
    );
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Payment',
    });
    expect(continueButton).toBeDisabled();

    const readyModel = createSession(true);
    rerender(<CheckoutStepComposition session={readyModel.session} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Continue to Payment' })
    );

    expect(captureClientEvent).toHaveBeenCalledWith(
      CHECKOUT_FUNNEL_EVENTS.checkoutStepCompleted,
      buildCheckoutFunnelProperties({
        channel: 'web',
        checkoutStep: 'shipping_info',
        source: 'web_checkout',
      })
    );
    expect(readyModel.setCompletedSteps).toHaveBeenCalledOnce();
    const update = readyModel.setCompletedSteps.mock.calls[0]?.[0];
    expect(update?.({ contact: true, delivery: false })).toEqual({
      contact: true,
      delivery: true,
    });
    expect(readyModel.setCurrentStep).toHaveBeenCalledWith('payment');
  });
});
