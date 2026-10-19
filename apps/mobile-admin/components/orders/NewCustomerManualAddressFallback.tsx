import Ionicons from '@react-native-vector-icons/ionicons';
import type { Dispatch, SetStateAction } from 'react';
import { View } from 'react-native';
import { SheetTextInput } from '@/components/ui/SheetTextInput';
import type { ThemeColors } from '@/constants/theme';
import { customerCreateStyles as customerStyles } from './NewOrderCustomerCreateView.styles';
import type { NewCustomerDraft } from './new-order.types';

interface NewCustomerManualAddressFallbackProps {
  address: string;
  city: string;
  colors: ThemeColors;
  onAddressChange: (text: string) => void;
  setNewCustomer: Dispatch<SetStateAction<NewCustomerDraft>>;
  state: string;
}

export function NewCustomerManualAddressFallback({
  address,
  city,
  colors,
  onAddressChange,
  setNewCustomer,
  state,
}: NewCustomerManualAddressFallbackProps) {
  return (
    <>
      <View
        style={[
          customerStyles.field,
          { backgroundColor: colors.inputBg, borderColor: colors.border },
        ]}
      >
        <Ionicons color={colors.error} name="map-outline" size={18} />
        <SheetTextInput
          accessibilityLabel="Customer address"
          onChangeText={onAddressChange}
          placeholder="Enter address"
          placeholderTextColor={colors.textMuted}
          style={[customerStyles.fieldInput, { color: colors.text }]}
          value={address}
        />
      </View>
      <View style={[customerStyles.nameRow, { marginTop: 8 }]}>
        <View
          style={[
            customerStyles.field,
            { backgroundColor: colors.inputBg, borderColor: colors.border },
          ]}
        >
          <SheetTextInput
            accessibilityLabel="Customer city"
            onChangeText={(text) =>
              setNewCustomer((previous) => ({ ...previous, city: text }))
            }
            placeholder="City"
            placeholderTextColor={colors.textMuted}
            style={[customerStyles.fieldInput, { color: colors.text }]}
            value={city}
          />
        </View>
        <View
          style={[
            customerStyles.field,
            { backgroundColor: colors.inputBg, borderColor: colors.border },
          ]}
        >
          <SheetTextInput
            accessibilityLabel="Customer state"
            onChangeText={(text) =>
              setNewCustomer((previous) => ({ ...previous, state: text }))
            }
            placeholder="State"
            placeholderTextColor={colors.textMuted}
            style={[customerStyles.fieldInput, { color: colors.text }]}
            value={state}
          />
        </View>
      </View>
    </>
  );
}
