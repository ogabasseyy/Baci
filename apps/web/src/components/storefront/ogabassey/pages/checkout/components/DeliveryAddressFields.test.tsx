import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { DeliveryAddressFields } from './DeliveryAddressFields';

const saved = {
  id: 1,
  label: 'Home',
  address: '10 Test Street',
  phone: '+2348123456789',
  isDefault: true,
};
const props = (): ComponentProps<typeof DeliveryAddressFields> => ({
  signedIn: true,
  addresses: [saved],
  isNewAddressMode: false,
  selectedAddressId: null,
  newAddressStreet: '',
  newAddressCity: 'Ikeja',
  newAddressState: 'Lagos',
  merchantCountry: 'NG',
  addressReady: false,
  onToggleAddressMode: vi.fn(),
  onSelectAddress: vi.fn(),
  onStreetChange: vi.fn(),
  onSelectPlace: vi.fn(),
});

it('lets signed-in customers choose a saved address or request a new one', () => {
  const callbacks = props();
  render(<DeliveryAddressFields {...callbacks} />);
  fireEvent.click(screen.getByRole('radio', { name: /home.*10 test street/i }));
  expect(callbacks.onSelectAddress).toHaveBeenCalledWith(saved);
  fireEvent.click(screen.getByRole('button', { name: /new address/i }));
  expect(callbacks.onToggleAddressMode).toHaveBeenCalledOnce();
});

it('exposes an autofill address input to guests and confirms the detected location', () => {
  const callbacks = props();
  render(
    <DeliveryAddressFields {...callbacks} signedIn={false} addressReady />
  );
  const address = screen.getByLabelText('Delivery Address');
  expect(address).toHaveAttribute('autocomplete', 'street-address');
  fireEvent.change(address, { target: { value: '10 Test Street' } });
  expect(callbacks.onStreetChange).toHaveBeenCalledWith('10 Test Street');
  expect(screen.getByText('Detected: Ikeja, Lagos')).toBeVisible();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
