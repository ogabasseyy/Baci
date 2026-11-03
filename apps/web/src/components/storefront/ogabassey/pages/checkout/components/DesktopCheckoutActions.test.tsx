import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DesktopCheckoutActions } from './DesktopCheckoutActions';

it('keeps the processing order button named and disabled for assistive technology', () => {
  render(
    <DesktopCheckoutActions
      hasUser
      newsletterOptIn={false}
      setNewsletterOptIn={vi.fn()}
      handlePlaceOrder={vi.fn()}
      isProcessing
      isDeliveryValid
      remainingAmount={1000}
      paymentMethod="paystack"
      redvaultOrderReady={false}
      isPayForMeValid
    />
  );

  expect(
    screen.getByRole('button', { name: 'Processing order' })
  ).toBeDisabled();
});

it('requires validated delivery before allowing the desktop order action', () => {
  const props = {
    hasUser: true,
    newsletterOptIn: false,
    setNewsletterOptIn: vi.fn(),
    handlePlaceOrder: vi.fn(),
    isProcessing: false,
    remainingAmount: 1000,
    paymentMethod: 'paystack' as const,
    redvaultOrderReady: false,
    isPayForMeValid: true,
  };
  const { rerender } = render(
    <DesktopCheckoutActions {...props} isDeliveryValid={false} />
  );
  const placeOrder = screen.getByRole('button', { name: /Place Order/ });
  expect(placeOrder).toBeDisabled();
  fireEvent.click(placeOrder);
  expect(props.handlePlaceOrder).not.toHaveBeenCalled();
  rerender(<DesktopCheckoutActions {...props} isDeliveryValid />);
  expect(placeOrder).toBeEnabled();
  fireEvent.click(placeOrder);
  expect(props.handlePlaceOrder).toHaveBeenCalledOnce();
});

it('labels the UBA confirmation while keeping delivery validation', () => {
  const props = {
    hasUser: true,
    newsletterOptIn: false,
    setNewsletterOptIn: vi.fn(),
    handlePlaceOrder: vi.fn(),
    isProcessing: false,
    remainingAmount: 102.5,
    paymentMethod: 'uba_redvault' as const,
    redvaultOrderReady: true,
    isPayForMeValid: true,
  };
  const { rerender } = render(
    <DesktopCheckoutActions {...props} isDeliveryValid={false} />
  );
  const action = screen.getByRole('button', {
    name: 'Review and continue to UBA',
  });
  expect(action).toBeDisabled();
  rerender(<DesktopCheckoutActions {...props} isDeliveryValid />);
  expect(action).toBeEnabled();
});
