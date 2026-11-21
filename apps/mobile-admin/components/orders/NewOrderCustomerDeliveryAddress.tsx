import { View } from 'react-native';
import type { useNewOrderController } from '@/hooks/useNewOrderController';
import { NewOrderAddressInput } from './NewOrderAddressInput';

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
            setCustomer((previous) => ({
              ...previous,
              ...(typeof update === 'function'
                ? update({
                    ...previous,
                    city: previous.city ?? '',
                    state: previous.state ?? '',
                  })
                : update),
            })),
        }}
        googleMapsApiKey={googleMapsApiKey}
      />
    </View>
  );
}
