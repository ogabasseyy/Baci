import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { expect, it, vi } from 'vitest';
import { DeliveryOptions } from './DeliveryOptions';

const props = (): ComponentProps<typeof DeliveryOptions> => ({
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
});

it('shows only the currently selected delivery method details', () => {
  const options = props();
  const { rerender } = render(<DeliveryOptions {...options} />);
  expect(
    screen.getByRole('group', { name: /how would you like to receive/i })
  ).toBeVisible();
  expect(
    screen.getByRole('heading', { name: 'Main Office Pickup' })
  ).toBeVisible();
  expect(
    screen.queryByText(/no nearby GIG Logistics pickup station/i)
  ).not.toBeInTheDocument();
  rerender(
    <DeliveryOptions
      {...options}
      tabs={{ ...options.tabs, deliveryMethod: 'pickup_station' }}
    />
  );
  expect(
    screen.queryByRole('heading', { name: 'Main Office Pickup' })
  ).not.toBeInTheDocument();
  expect(
    screen.getByText(/no nearby GIG Logistics pickup station/i)
  ).toBeVisible();
});
