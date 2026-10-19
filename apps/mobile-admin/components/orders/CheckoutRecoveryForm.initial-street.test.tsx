import type { Order } from '@baci/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/lib/checkout-shipping-recovery', () => ({
  requestCheckoutShippingRecovery: api,
}));
vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({
    colors: {
      text: '#111',
      textSecondary: '#555',
      primary: '#00f',
      border: '#ddd',
    },
  }),
}));
vi.mock('./CheckoutRecoveryAddressInput', async () => {
  const { checkoutRecoveryFormFixtures } = await import(
    './CheckoutRecoveryForm.test-support'
  );
  return {
    CheckoutRecoveryAddressInput: checkoutRecoveryFormFixtures.AddressInput,
  };
});

import { CheckoutRecoveryForm } from './CheckoutRecoveryForm';

function show(address: unknown) {
  const order = {
    id: 'order',
    customer_phone: '08012345678',
    shipping_address: address,
  } as unknown as Order;
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CheckoutRecoveryForm
        order={order}
        onBlockingChange={vi.fn()}
        onBusyChange={vi.fn()}
      />
    </QueryClientProvider>
  );
}
const legacy = {
  address_line1: '12 Saved Street',
  address_line2: 'Flat 4',
  city: 'Ikeja',
  state: 'Lagos',
  latitude: 6.5,
  longitude: 3.3,
};

describe('CheckoutRecoveryForm legacy apartment initialization', () => {
  beforeEach(() => {
    api.mockReset();
    api.mockRejectedValue(new Error('Preview stopped after capture'));
  });
  it('shows the original apartment in the editable street and explicitly previewed receiver without prefilling a pin', async () => {
    show(legacy);
    expect(
      (screen.getByLabelText('Recovery address') as HTMLInputElement).value
    ).toBe('12 Saved Street, Flat 4');
    expect(
      (screen.getByLabelText('Recovery latitude') as HTMLInputElement).value
    ).toBe('');
    expect(
      (screen.getByLabelText('Recovery longitude') as HTMLInputElement).value
    ).toBe('');
    expect(api).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Recovery latitude'), {
      target: { value: '6.6' },
    });
    fireEvent.change(screen.getByLabelText('Recovery longitude'), {
      target: { value: '3.4' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview new shipping quote' })
    );
    await vi.waitFor(() =>
      expect(api).toHaveBeenCalledWith('order', {
        action: 'preview',
        receiver: {
          address: '12 Saved Street, Flat 4',
          city: 'Ikeja',
          state: 'Lagos',
          countryCode: '',
          phone: '08012345678',
          latitude: 6.6,
          longitude: 3.4,
        },
      })
    );
  });
  it('does not duplicate an apartment already included in the canonical street', () => {
    show({ ...legacy, address: '12 Saved Street, Flat 4' });
    expect(
      (screen.getByLabelText('Recovery address') as HTMLInputElement).value
    ).toBe('12 Saved Street, Flat 4');
  });
  it('does not reattach the original apartment after selecting or manually entering a different destination', () => {
    show(legacy);
    fireEvent.click(
      screen.getByRole('button', { name: 'Select destination pin' })
    );
    expect(
      (screen.getByLabelText('Recovery address') as HTMLInputElement).value
    ).toBe('Selected destination');
    fireEvent.change(screen.getByLabelText('Recovery address'), {
      target: { value: 'New street, Unit 8' },
    });
    expect(
      (screen.getByLabelText('Recovery address') as HTMLInputElement).value
    ).toBe('New street, Unit 8');
    expect(
      (screen.getByLabelText('Recovery latitude') as HTMLInputElement).value
    ).toBe('');
  });
});
