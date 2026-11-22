import type { Dispatch, SetStateAction } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ThemeColors } from '@/constants/theme';
import {
  getCustomerDisplayContact,
  getCustomerDisplayInitial,
  getCustomerDisplayName,
} from './new-order.shared';
import type { SelectableCustomer } from './new-order.types';

interface DuplicateCustomerBannerProps {
  colors: ThemeColors;
  duplicateCustomer: SelectableCustomer;
  disabled?: boolean;
  handleSelectCustomer: (customer: SelectableCustomer) => void;
  keepsEnteredAddress?: boolean;
  resetNewCustomerForm: () => void;
  setDuplicateCustomer: Dispatch<SetStateAction<SelectableCustomer | null>>;
  setIsCreatingCustomer: Dispatch<SetStateAction<boolean>>;
}

export function DuplicateCustomerBanner({
  colors,
  duplicateCustomer,
  disabled = false,
  handleSelectCustomer,
  keepsEnteredAddress = false,
  resetNewCustomerForm,
  setDuplicateCustomer,
  setIsCreatingCustomer,
}: DuplicateCustomerBannerProps) {
  return (
    <View
      style={{
        backgroundColor: colors.warningLight,
        borderColor: colors.warning,
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
        padding: 12,
      }}
    >
      <Text style={{ color: colors.warning, fontWeight: '600' }}>
        ⚠️ Customer Already Exists
      </Text>
      {keepsEnteredAddress ? (
        <Text style={{ color: colors.text }}>
          The address you entered will be used for this order.
        </Text>
      ) : null}
      <Pressable
        accessibilityLabel="Use existing customer"
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => {
          handleSelectCustomer(duplicateCustomer);
          setDuplicateCustomer(null);
          setIsCreatingCustomer(false);
          resetNewCustomerForm();
        }}
        style={{
          alignItems: 'center',
          backgroundColor: colors.card,
          borderRadius: 8,
          flexDirection: 'row',
          gap: 12,
          opacity: disabled ? 0.5 : 1,
          padding: 12,
        }}
      >
        <View
          style={{
            alignItems: 'center',
            backgroundColor: colors.primary,
            borderRadius: 20,
            height: 40,
            justifyContent: 'center',
            width: 40,
          }}
        >
          <Text
            style={{
              color: colors.textOnPrimary,
              fontSize: 16,
              fontWeight: 'bold',
            }}
          >
            {getCustomerDisplayInitial(duplicateCustomer)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>
            {getCustomerDisplayName(duplicateCustomer)}
          </Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            {getCustomerDisplayContact(duplicateCustomer)}
          </Text>
        </View>
        <View
          style={{
            backgroundColor: colors.primary,
            borderRadius: 6,
            paddingHorizontal: 12,
            paddingVertical: 6,
          }}
        >
          <Text
            style={{
              color: colors.textOnPrimary,
              fontSize: 13,
              fontWeight: '600',
            }}
          >
            Use This
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
