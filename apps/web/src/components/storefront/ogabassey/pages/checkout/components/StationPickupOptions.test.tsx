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
    />
  );
  expect(screen.getByRole('radio', { name: /ikeja station/i })).toBeChecked();
  expect(screen.getAllByText('Bring the collection code')).toHaveLength(2);
  fireEvent.click(screen.getByRole('radio', { name: /yaba station/i }));
  expect(select).toHaveBeenCalledWith('yaba');
});

it('explains when no station serves the address', () => {
  render(
    <StationPickupOptions
      isLoadingQuotes={false}
      stationPickupQuote={undefined}
      stationPickupQuotes={[]}
      selectedQuoteId=""
      setSelectedQuoteId={vi.fn()}
    />
  );
  expect(
    screen.getByText(/no nearby GIG Logistics pickup station/i)
  ).toBeVisible();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
