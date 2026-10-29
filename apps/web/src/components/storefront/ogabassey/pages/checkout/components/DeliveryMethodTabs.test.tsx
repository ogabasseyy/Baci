import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DeliveryMethodTabs } from './DeliveryMethodTabs';

it('offers local pickup only for an eligible OgaBassey address', () => {
  const onSelect = vi.fn();
  const props = {
    deliveryMethod: 'door' as const,
    newAddressState: 'Lagos',
    merchantSlug: 'ogabassey',
    stationPickupQuote: undefined,
    hasMerchantPickupQuote: false,
    onSelect,
  };
  const { rerender } = render(<DeliveryMethodTabs {...props} />);
  expect(screen.getByRole('button', { name: /by road/i })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getByRole('button', { name: /store pickup/i })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  fireEvent.click(screen.getByRole('button', { name: /store pickup/i }));
  expect(onSelect).toHaveBeenCalledWith('pickup');
  expect(
    screen.queryByRole('button', { name: /by air/i })
  ).not.toBeInTheDocument();
  rerender(<DeliveryMethodTabs {...props} merchantSlug="another-store" />);
  expect(
    screen.queryByRole('button', { name: /store pickup/i })
  ).not.toBeInTheDocument();
});

it('labels mixed store and courier collection as pickup locations', () => {
  render(
    <DeliveryMethodTabs
      deliveryMethod="pickup_station"
      newAddressState="Lagos"
      merchantSlug="ogabassey"
      stationPickupQuote={undefined}
      hasMerchantPickupQuote
      hasMixedPickupLocations
      onSelect={vi.fn()}
    />
  );
  expect(
    screen.getByRole('button', {
      name: /Pickup locations.*Store or service centre/i,
    })
  ).toHaveAttribute('aria-pressed', 'true');
});

it('hides legacy pickup when merchant pickup rates are configured', () => {
  render(
    <DeliveryMethodTabs
      deliveryMethod="door"
      newAddressState="Lagos"
      merchantSlug="ogabassey"
      stationPickupQuote={undefined}
      hasMerchantPickupQuote
      onSelect={vi.fn()}
    />
  );
  expect(
    screen.queryByRole('button', { name: /collect at store/i })
  ).not.toBeInTheDocument();
  expect(screen.getAllByRole('button')).toHaveLength(2);
});
