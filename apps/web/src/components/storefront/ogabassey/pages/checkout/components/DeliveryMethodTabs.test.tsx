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
