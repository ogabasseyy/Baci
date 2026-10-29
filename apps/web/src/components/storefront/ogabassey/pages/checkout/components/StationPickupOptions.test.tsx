import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ShippingQuote } from '@/types/shipping-quote';
import { StationPickupOptions } from './StationPickupOptions';

const quote: ShippingQuote = {
  id: 'ikeja',
  provider: 'GIGL',
  serviceTier: 'pickup',
  carrierName: 'GIG Logistics',
  displayName: 'Ikeja station',
  estimatedDays: 2,
  price: 2000,
  currency: 'NGN',
  pickupIncluded: false,
  insuranceIncluded: false,
  isStationPickup: true,
  stationAddress: '10 Test Street',
  stationInstructions: 'Bring the collection code',
};

it('shows every station with collection directions and permits changing selection', () => {
  const select = vi.fn();
  render(
    <StationPickupOptions
      isLoadingQuotes={false}
      stationPickupQuote={quote}
      stationPickupQuotes={[
        quote,
        { ...quote, id: 'yaba', displayName: 'Yaba station' },
      ]}
      selectedQuoteId="ikeja"
      setSelectedQuoteId={select}
      onRefreshRates={vi.fn()}
    />
  );
  expect(screen.getByRole('radio', { name: /ikeja station/i })).toBeChecked();
  expect(screen.getAllByText('Bring the collection code')).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: /yaba station/i }));
  expect(select).toHaveBeenCalledWith('yaba');
});

it.each([
  false,
  true,
])('offers retry without claiming no coverage when quotes are empty and missing pin is %j', (needsGiglLocation) => {
  const retry = vi.fn();
  render(
    <StationPickupOptions
      isLoadingQuotes={false}
      stationPickupQuote={undefined}
      stationPickupQuotes={[]}
      selectedQuoteId=""
      setSelectedQuoteId={vi.fn()}
      onRefreshRates={retry}
      needsGiglLocation={needsGiglLocation}
    />
  );
  expect(
    screen.getByText(/Pickup station rates are unavailable/i)
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole('button', { name: 'Retry pickup station rates' })
  );
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});

it('keeps merchant collection and GIG stations distinct in a mixed pickup list', () => {
  render(
    <StationPickupOptions
      isLoadingQuotes={false}
      stationPickupQuote={quote}
      stationPickupQuotes={[
        quote,
        {
          ...quote,
          id: 'store',
          provider: 'MERCHANT',
          displayName: 'Merchant collection',
        },
      ]}
      selectedQuoteId=""
      setSelectedQuoteId={vi.fn()}
      onRefreshRates={vi.fn()}
      hasMixedPickupLocations
    />
  );
  expect(screen.getByRole('group', { name: 'Pickup locations' })).toBeVisible();
  expect(
    screen.getByRole('radio', {
      name: /Ikeja station.*Pickup Stations \(GIGL\)/,
    })
  ).toBeVisible();
  expect(
    screen.getByRole('radio', { name: /Merchant collection.*Store Pickup/ })
  ).toBeVisible();
});
