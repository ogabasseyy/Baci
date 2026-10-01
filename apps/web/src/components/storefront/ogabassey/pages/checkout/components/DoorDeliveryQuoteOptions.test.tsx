import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ShippingQuote } from '../types';
import { DoorDeliveryQuoteOptions } from './DoorDeliveryQuoteOptions';

vi.mock('../../../components/SmartQuoteLoader', () => ({
  SmartQuoteLoader: () => <p>Calculating delivery</p>,
}));

const quote: ShippingQuote = {
  id: 'gigl-road',
  provider: 'GIGL',
  carrierName: 'GIG Logistics',
  displayName: 'GIG Logistics - GoStandard',
  serviceTier: 'Standard',
  price: 3518,
  currency: 'NGN',
  estimatedDays: 3,
  insuranceIncluded: true,
  pickupIncluded: true,
};
const callbacks = {
  onSelectQuote: vi.fn(),
  onSelectStationPickup: vi.fn(),
  onRefreshRates: vi.fn(),
};

function show(quotes: ShippingQuote[], loading = false) {
  return render(
    <DoorDeliveryQuoteOptions
      {...callbacks}
      isLoadingQuotes={loading}
      doorDeliveryQuotes={quotes}
      stationPickupQuote={undefined}
      selectedQuoteId={''}
    />
  );
}

describe('DoorDeliveryQuoteOptions', () => {
  it.each([
    1, 2,
  ])('renders %i rate rows without reserving empty space', (count) => {
    const { container } = show(
      Array.from({ length: count }, (_, i) => ({ ...quote, id: `quote-${i}` }))
    );
    expect(screen.getAllByRole('radio')).toHaveLength(count);
    // Regression: the prior 320px scroll box separated one quote from Continue.
    expect(container.querySelector('[class*="h-[320px]"]')).toBeNull();
  });
  it('selects the displayed quote', () => {
    show([quote]);
    fireEvent.click(screen.getByRole('radio'));
    expect(callbacks.onSelectQuote).toHaveBeenCalledWith(quote.id);
  });

  describe('bugfix: GIGL badge contrast under light primary themes', () => {
    it('pairs the GIGL badge with a matching background foreground token', () => {
      show([quote]);
      expect(screen.getByText('GIGL')).toHaveClass(
        'bg-store-background-text',
        'text-store-background'
      );
      expect(screen.getByText('GIGL')).not.toHaveClass('text-store-primary-text');
    });
  });
  it('shows loading without a stale rate', () => {
    show([quote], true);
    expect(screen.getByText('Calculating delivery')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
  it('lets the shopper retry when no delivery rate is available', () => {
    show([]);
    fireEvent.click(screen.getByRole('button'));
    expect(callbacks.onRefreshRates).toHaveBeenCalled();
  });
});
