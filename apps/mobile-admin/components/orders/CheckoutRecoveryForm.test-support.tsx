import type { Order } from '@baci/shared';

const AddressInput = ({
  disabled,
  onSearchChange,
  onSelect,
}: {
  disabled: boolean;
  onSearchChange: (text: string) => void;
  onSelect: (value: Record<string, string>) => void;
}) => (
  <>
    <input
      aria-label="Destination search"
      disabled={disabled}
      onChange={(event) => onSearchChange(event.target.value)}
    />
    <button
      type="button"
      disabled={disabled}
      onClick={() =>
        onSelect({
          address: 'Selected destination',
          city: 'Ikeja',
          state: 'Lagos',
          countryCode: 'NG',
          latitude: '6.6',
          longitude: '3.4',
        })
      }
    >
      Select destination pin
    </button>
  </>
);

const order = {
  id: 'order',
  customer_phone: '08012345678',
  shipping_address: {
    address_line1: 'Saved street',
    city: 'Ikeja',
    state: 'Lagos',
    latitude: 6.7,
    longitude: 3.5,
    countryCode: 'NG',
  },
} as unknown as Order;
const preview = () => ({
  previewId: 'preview',
  canConfirm: true,
  paidShippingFee: 100,
  quote: {
    price: 100,
    displayName: 'GIG Logistics',
    expiresAt: '2099-01-01T12:00:00Z',
    estimatedDays: 2,
  },
});

export const checkoutRecoveryFormFixtures = { AddressInput, order, preview };
