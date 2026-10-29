import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DesktopCheckoutActions } from './DesktopCheckoutActions';

it('requires validated delivery before allowing the desktop order action', () => {
  const props = {
    hasUser: true,
    newsletterOptIn: false,
    setNewsletterOptIn: vi.fn(),
    handlePlaceOrder: vi.fn(),
    isProcessing: false,
    remainingAmount: 1000,
    paymentMethod: 'paystack' as const,
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
