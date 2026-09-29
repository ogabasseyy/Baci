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
        Continue to delivery
      </button>
    </section>
  ),
}));

vi.mock('./PaymentStep', () => ({
  PaymentStep: ({ currentStep }: ComponentProps<typeof PaymentStep>) => (
    <section aria-label="Payment">Current checkout step: {currentStep}</section>
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
      screen.getByRole('button', { name: 'Continue to delivery' })
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
      screen.getByRole('button', { name: 'Continue to delivery' })
    ).toBeEnabled();
    expect(
      screen.getByText('Current checkout step: delivery')
    ).toBeInTheDocument();
  });
});
