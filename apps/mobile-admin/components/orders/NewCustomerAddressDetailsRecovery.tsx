import type { Dispatch, SetStateAction } from 'react';
import { Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import { NewCustomerManualAddressFallback } from './NewCustomerManualAddressFallback';
import type { NewCustomerDraft } from './new-order.types';

interface NewCustomerAddressDetailsRecoveryProps {
  address: string;
  city: string;
  colors: ThemeColors;
  error: string;
  onAddressChange: (text: string) => void;
  setNewCustomer: Dispatch<SetStateAction<NewCustomerDraft>>;
  state: string;
}

export function NewCustomerAddressDetailsRecovery({
  address,
  city,
  colors,
  error,
  onAddressChange,
  setNewCustomer,
  state,
}: NewCustomerAddressDetailsRecoveryProps) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text
        accessibilityRole="alert"
        style={{ color: colors.error, fontSize: 13, marginBottom: 8 }}
      >
        {error}
      </Text>
      <NewCustomerManualAddressFallback
        address={address}
        city={city}
        colors={colors}
        onAddressChange={onAddressChange}
        setNewCustomer={setNewCustomer}
        state={state}
      />
    </View>
  );
}
