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
    onCityChange: vi.fn(),
    onStateChange: vi.fn(),
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
  expect(
    screen.getByRole('button', { name: 'Continue to Payment' })
  ).toHaveAccessibleDescription(
    'Enter your street address, city and state to see delivery options.'
  );

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

it('asks for city and state before suggesting a pickup availability refresh', () => {
  const callbacks = props(false);
  const deliveryOptions: NonNullable<typeof callbacks.deliveryOptions> = {
    tabs: {
      deliveryMethod: 'pickup',
      newAddressState: 'Lagos',
      merchantSlug: 'ogabassey',
      stationPickupQuote: undefined,
      hasMerchantPickupQuote: false,
      onSelect: vi.fn(),
    },
    station: {
      isLoadingQuotes: false,
      stationPickupQuote: undefined,
      stationPickupQuotes: [],
      selectedQuoteId: '',
      setSelectedQuoteId: vi.fn(),
    },
    airport: {
      airportType: 'delivery',
      city: 'Ikeja',
      state: 'Lagos',
      selectedQuoteId: '',
      selectedQuoteMatchesDeliveryMethod: false,
      airDeliveryQuotes: [],
      onSelectAirportType: vi.fn(),
      onSelectQuote: vi.fn(),
    },
    door: {
      isLoadingQuotes: false,
      doorDeliveryQuotes: [],
      stationPickupQuote: undefined,
      selectedQuoteId: '',
      onSelectQuote: vi.fn(),
      onSelectStationPickup: vi.fn(),
      onRefreshRates: vi.fn(),
    },
  };
  const { rerender } = render(
    <CheckoutDeliveryStep {...callbacks} deliveryOptions={deliveryOptions} />
  );
  const button = screen.getByRole('button', { name: 'Continue to Payment' });
  expect(button).toHaveAccessibleDescription(
    'Enter your city and state to check pickup availability.'
  );

  rerender(
    <CheckoutDeliveryStep
      {...callbacks}
      deliveryOptions={{
        ...deliveryOptions,
        door: { ...deliveryOptions.door, isLoadingQuotes: true },
      }}
    />
  );
  expect(button).toHaveAccessibleDescription(
    'Checking pickup availability before continuing.'
  );

  rerender(
    <CheckoutDeliveryStep
      {...callbacks}
      addressFields={{
        ...callbacks.addressFields,
        newAddressCity: 'Ikeja',
        newAddressState: 'Lagos',
      }}
      deliveryOptions={deliveryOptions}
    />
  );
  expect(button).toHaveAccessibleDescription(
    'Refresh pickup availability to continue.'
  );
});
