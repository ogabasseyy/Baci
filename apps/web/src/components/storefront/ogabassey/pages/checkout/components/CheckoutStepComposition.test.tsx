import {
  buildCheckoutFunnelProperties,
  CHECKOUT_FUNNEL_EVENTS,
} from '@baci/shared/contracts';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { captureClientEvent } from '@/lib/posthog/capture-client-event';
import type { CheckoutDeliveryStep } from './CheckoutDeliveryStep';
import { CheckoutStepComposition } from './CheckoutStepComposition';
import { createCheckoutStepSession } from './CheckoutStepComposition.test-fixtures';
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
    <section
      aria-current={currentStep === 'payment' ? 'step' : undefined}
      aria-label="Payment"
    >
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

function expectCurrentStep(name: string) {
  const currentSteps = screen
    .getAllByRole('region')
    .filter((region) => region.getAttribute('aria-current') === 'step');
  expect(currentSteps).toHaveLength(1);
  expect(currentSteps[0]).toHaveAccessibleName(name);
}

describe('CheckoutStepComposition', () => {
  it('composes ordered steps, sign-in, account, newsletter, and Redvault session state', () => {
    const model = createCheckoutStepSession();
    const { rerender } = render(
      <CheckoutStepComposition session={model.session} />
    );

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

    const incompleteContact = createCheckoutStepSession({
      contactComplete: false,
    });
    rerender(<CheckoutStepComposition session={incompleteContact.session} />);
    expect(
      screen.getByRole('button', { name: 'Delivery Method' })
    ).toBeDisabled();

    const signedIn = createCheckoutStepSession({ signedIn: true });
    rerender(<CheckoutStepComposition session={signedIn.session} />);
    expect(
      screen.queryByRole('heading', { name: 'Already have an account?' })
    ).not.toBeInTheDocument();
  });

  it('captures delivery completion and advances only after validation passes', () => {
    const model = createCheckoutStepSession();
    const { rerender } = render(
      <CheckoutStepComposition session={model.session} />
    );
    const continueButton = screen.getByRole('button', {
      name: 'Continue to Payment',
    });
    expect(continueButton).toBeDisabled();

    const readyModel = createCheckoutStepSession({ isDeliveryValid: true });
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

  it('marks only the selected checkout step as current when the session changes', () => {
    const { rerender } = render(
      <CheckoutStepComposition session={createCheckoutStepSession().session} />
    );

    expectCurrentStep('Contact details');

    rerender(
      <CheckoutStepComposition
        session={createCheckoutStepSession({ currentStep: 'delivery' }).session}
      />
    );
    expectCurrentStep('Delivery details');

    rerender(
      <CheckoutStepComposition
        session={createCheckoutStepSession({ currentStep: 'payment' }).session}
      />
    );
    expectCurrentStep('Payment');
  });
});
