import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { CheckoutDeliveryStep } from './CheckoutDeliveryStep';

const props = (
  isDeliveryValid: boolean
): ComponentProps<typeof CheckoutDeliveryStep> => ({
  active: true,
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
  completed: false,
  deliveryOptions: null,
  disabled: false,
  focusOnActivate: false,
  isDeliveryValid,
  onContinue: vi.fn(),
  onOpen: vi.fn(),
  summary: 'By Road · Ikeja',
});

it('keeps delivery navigation gated until the address and delivery choice are valid', () => {
  const callbacks = props(false);
  const { rerender } = render(<CheckoutDeliveryStep {...callbacks} />);

  expect(
    screen.getByRole('heading', { name: 'Delivery Method' })
  ).toBeVisible();
  expect(screen.getByLabelText('Delivery Address')).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Continue to Payment' })
  ).toBeDisabled();

  fireEvent.change(screen.getByLabelText('Delivery Address'), {
    target: { value: '12 Allen Avenue' },
  });
  expect(callbacks.addressFields.onStreetChange).toHaveBeenCalledWith(
    '12 Allen Avenue'
  );

  rerender(<CheckoutDeliveryStep {...callbacks} isDeliveryValid={true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));
  expect(callbacks.onContinue).toHaveBeenCalledOnce();
});

it('shows the completed delivery summary and allows reopening the step', () => {
  const callbacks = props(true);
  render(
    <CheckoutDeliveryStep {...callbacks} active={false} completed={true} />
  );

  expect(screen.getByText('By Road · Ikeja')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Delivery Method' }));
  expect(callbacks.onOpen).toHaveBeenCalledOnce();
});
