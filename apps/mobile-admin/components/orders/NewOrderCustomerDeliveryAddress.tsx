import type { SetStateAction } from 'react';
import { View } from 'react-native';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { NewOrderAddressInput } from './NewOrderAddressInput';
import type { CustomerInfo, DeliveryInfo } from './new-order.types';

export function applyCustomerDeliveryAddressUpdate(
  previous: CustomerInfo,
  update: SetStateAction<DeliveryInfo>
): CustomerInfo {
  const current: DeliveryInfo = {
    ...previous,
    city: previous.city ?? '',
    state: previous.state ?? '',
  };
  const next =
    typeof update === 'function' ? update(current) : { ...current, ...update };

  return {
    ...previous,
    address: next.address,
    city: next.city,
    state: next.state,
    country: next.country,
    countryCode: next.countryCode,
    postalCode: next.postalCode,
    latitude: next.latitude,
    longitude: next.longitude,
  };
}

interface Props {
  controller: Pick<
    ReturnType<typeof useNewOrderController>,
    'colors' | 'customer' | 'customerSelectionRevision' | 'setCustomer'
  >;
  googleMapsApiKey: string | undefined;
}

export function NewOrderCustomerDeliveryAddress({
  controller,
  googleMapsApiKey,
}: Props) {
  const { colors, customer, customerSelectionRevision, setCustomer } =
    controller;
  return (
    <View style={{ padding: 16 }}>
      <NewOrderAddressInput
        key={customerSelectionRevision}
        controller={{
          colors,
          deliveryInfo: {
            ...customer,
            city: customer.city ?? '',
            state: customer.state ?? '',
          },
          setDeliveryInfo: (update) =>
            setCustomer((previous) =>
              applyCustomerDeliveryAddressUpdate(previous, update)
            ),
        }}
        googleMapsApiKey={googleMapsApiKey}
      />
    </View>
  );
}
