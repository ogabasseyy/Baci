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
  it('does not display a stale GIG quote after its destination location is cleared', () => {
    render(
      <DoorDeliveryQuoteOptions
        {...callbacks}
        isLoadingQuotes={false}
        doorDeliveryQuotes={[quote]}
        stationPickupQuote={undefined}
        selectedQuoteId={quote.id}
        needsGiglLocation
      />
    );
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Confirm location for GIG delivery'
    );
  });
  it('explains missing GIG coordinates while keeping merchant rate recovery available', () => {
    render(
      <DoorDeliveryQuoteOptions
        {...callbacks}
        isLoadingQuotes={false}
        doorDeliveryQuotes={[]}
        stationPickupQuote={undefined}
        selectedQuoteId=""
        needsGiglLocation
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Confirm location for GIG delivery'
    );
    expect(
      screen.getByRole('button', { name: 'Refresh delivery rates' })
    ).toBeEnabled();
  });
  it('keeps an available merchant quote usable without a GIG location', () => {
    render(
      <DoorDeliveryQuoteOptions
        {...callbacks}
        isLoadingQuotes={false}
        doorDeliveryQuotes={[
          {
            ...quote,
            provider: 'MERCHANT',
            carrierName: 'Store',
            displayName: 'Store delivery',
          },
        ]}
        stationPickupQuote={undefined}
        selectedQuoteId=""
        needsGiglLocation
      />
    );
    expect(screen.getByRole('radio', { name: /Store delivery/ })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('offers retry when pickup rates exist but home coverage could not be checked', () => {
    const onRefreshRates = vi.fn();
    render(
      <DoorDeliveryQuoteOptions
        {...callbacks}
        onRefreshRates={onRefreshRates}
        isLoadingQuotes={false}
        doorDeliveryQuotes={[]}
        stationPickupQuote={{
          ...quote,
          isStationPickup: true,
          homeDeliveryCoverage: 'unavailable',
        }}
        selectedQuoteId=""
      />
    );
    expect(
      screen.getByText('Home delivery could not be confirmed.')
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry home delivery' })
    );
    expect(onRefreshRates).toHaveBeenCalledOnce();
  });
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
      expect(screen.getByText('GIGL')).not.toHaveClass(
        'text-store-primary-text'
      );
    });
  });
  it('shows loading without a stale rate', () => {
    show([quote], true);
    expect(screen.getByText('Calculating delivery')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
  it('lets the shopper retry when no delivery rate is available', () => {
    show([]);
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh delivery rates' })
    );
    expect(callbacks.onRefreshRates).toHaveBeenCalled();
  });
});
