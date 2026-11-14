import type { OrderGiglSelectedPlace } from '@/lib/order-gigl-shipping';
import { CheckoutRecoveryAddressInput } from './CheckoutRecoveryAddressInput';

interface Props {
  address: string;
  disabled: boolean;
  onPlaceSelect: (place: OrderGiglSelectedPlace) => void;
  onSearchChange: (text: string) => void;
}

/** Places search for a GIG delivery address missing from the order. */
export function ShipmentGiglAddressSearch({
  address,
  disabled,
  onPlaceSelect,
  onSearchChange,
}: Props) {
  return (
    <CheckoutRecoveryAddressInput
      accessibilityLabel="Search shipping address"
      address={address}
      disabled={disabled}
      onSearchChange={onSearchChange}
      onSelect={(place) => {
        const latitude = Number.parseFloat(place.latitude);
        const longitude = Number.parseFloat(place.longitude);
        const hasPin = Number.isFinite(latitude) && Number.isFinite(longitude);
        onPlaceSelect({
          address: place.address,
          city: place.city,
          state: place.state,
          latitude: hasPin ? latitude : undefined,
          longitude: hasPin ? longitude : undefined,
        });
      }}
      placeholder="Search delivery address"
    />
  );
}
