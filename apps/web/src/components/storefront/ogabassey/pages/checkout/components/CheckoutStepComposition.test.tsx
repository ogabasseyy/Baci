import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { CheckoutDeliveryStep } from './CheckoutDeliveryStep';
import { CheckoutStepComposition } from './CheckoutStepComposition';
import type { ContactStep } from './ContactStep';
import type { PaymentStep } from './PaymentStep';

vi.mock('./ContactStep', () => ({
  ContactStep: ({ active, completed }: ComponentProps<typeof ContactStep>) => (
    <div
      data-testid="contact-step"
      data-active={active}
      data-completed={completed}
    />
  ),
}));

vi.mock('./CheckoutDeliveryStep', () => ({
  CheckoutDeliveryStep: ({
    active,
    completed,
    disabled,
  }: ComponentProps<typeof CheckoutDeliveryStep>) => (
    <div
      data-testid="delivery-step"
      data-active={active}
      data-completed={completed}
      data-disabled={disabled}
    />
  ),
}));

vi.mock('./PaymentStep', () => ({
  PaymentStep: ({ currentStep }: ComponentProps<typeof PaymentStep>) => (
    <div data-testid="payment-step" data-current-step={currentStep} />
  ),
}));

const emptyContactProps = {} as ComponentProps<typeof ContactStep>;
const emptyDeliveryProps = {} as ComponentProps<typeof CheckoutDeliveryStep>;
const emptyPaymentProps = {} as ComponentProps<typeof PaymentStep>;

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

    expect(screen.getByText('Already have an account?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(onSignIn).toHaveBeenCalledOnce();

    const panelOrder = Array.from(
      document.querySelectorAll('[data-testid$="-step"]')
    ).map((panel) => panel.getAttribute('data-testid'));
    expect(panelOrder).toEqual([
      'contact-step',
      'delivery-step',
      'payment-step',
    ]);
    expect(screen.getByTestId('contact-step')).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(screen.getByTestId('delivery-step')).toHaveAttribute(
      'data-disabled',
      'true'
    );

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
      screen.queryByText('Already have an account?')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('contact-step')).toHaveAttribute(
      'data-completed',
      'true'
    );
    expect(screen.getByTestId('delivery-step')).toHaveAttribute(
      'data-active',
      'true'
    );
    expect(screen.getByTestId('delivery-step')).toHaveAttribute(
      'data-disabled',
      'false'
    );
    expect(screen.getByTestId('payment-step')).toHaveAttribute(
      'data-current-step',
      'delivery'
    );
  });
});
