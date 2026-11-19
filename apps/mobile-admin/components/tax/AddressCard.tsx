import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { styles } from './styles';
import type { TaxCardShadow, TaxColors } from './types';

interface AddressCardProps {
  colors: TaxColors;
  shadowStyle: TaxCardShadow;
  street: string;
  city: string;
  postalCode: string;
  selectedStateName: string;
  isPending: boolean;
  onStreetChange: (value: string) => void;
  onCityChange: (value: string) => void;
  onPostalCodeChange: (value: string) => void;
  onOpenStatePicker: () => void;
  onSave: () => void;
}

export function AddressCard({
  colors,
  shadowStyle,
  street,
  city,
  postalCode,
  selectedStateName,
  isPending,
  onStreetChange,
  onCityChange,
  onPostalCodeChange,
  onOpenStatePicker,
  onSave,
}: AddressCardProps) {
  const cityRef = useRef<TextInputInstance>(null);
  const postalCodeRef = useRef<TextInputInstance>(null);

  return (
    <View style={[styles.card, { backgroundColor: colors.card }, shadowStyle]}>
      <View style={styles.cardHeader}>
        <View
          style={[styles.iconContainer, { backgroundColor: colors.cardHover }]}
        >
          <Ionicons
            name="location-outline"
            size={24}
            color={colors.textSecondary}
          />
        </View>
        <View style={styles.cardHeaderText}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Registered Business Address
          </Text>
          <Text
            style={[styles.toggleDescription, { color: colors.textSecondary }]}
          >
            Official address for tax invoices
          </Text>
        </View>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        Street Address
      </Text>
      <TextInput
        style={[
          styles.textInput,
          {
            color: colors.text,
            backgroundColor: colors.cardHover,
            borderColor: colors.border,
          },
        ]}
        placeholder="e.g. 123 Marina Road"
        placeholderTextColor={colors.textMuted}
        value={street}
        onChangeText={onStreetChange}
        accessibilityLabel="Street address"
        returnKeyType="next"
        onSubmitEditing={() => cityRef.current?.focus()}
      />

      <View style={styles.row}>
        <View style={styles.halfField}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            City
          </Text>
          <TextInput
            ref={cityRef}
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.cardHover,
                borderColor: colors.border,
              },
            ]}
            placeholder="e.g. Lagos"
            placeholderTextColor={colors.textMuted}
            value={city}
            onChangeText={onCityChange}
            accessibilityLabel="City"
            returnKeyType="next"
            onSubmitEditing={() => postalCodeRef.current?.focus()}
          />
        </View>
        <View style={styles.halfField}>
          <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
            Postal Code
          </Text>
          <TextInput
            ref={postalCodeRef}
            style={[
              styles.textInput,
              {
                color: colors.text,
                backgroundColor: colors.cardHover,
                borderColor: colors.border,
              },
            ]}
            placeholder="e.g. 100001"
            placeholderTextColor={colors.textMuted}
            value={postalCode}
            onChangeText={onPostalCodeChange}
            keyboardType="number-pad"
            accessibilityLabel="Postal Code"
            returnKeyType="done"
            onSubmitEditing={onSave}
          />
        </View>
      </View>

      <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
        State
      </Text>
      <Pressable
        style={[
          styles.stateSelector,
          {
            backgroundColor: colors.cardHover,
            borderColor: colors.border,
          },
        ]}
        onPress={onOpenStatePicker}
        accessibilityRole="button"
        accessibilityLabel={`State selector, current value: ${selectedStateName || 'none'}`}
        accessibilityHint="Opens a modal to select your state"
      >
        <Text
          style={[
            styles.stateSelectorText,
            {
              color: selectedStateName ? colors.text : colors.textMuted,
            },
          ]}
        >
          {selectedStateName || 'Select state...'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textSecondary} />
      </Pressable>

      <Pressable
        style={[styles.saveButton, { backgroundColor: colors.primary }]}
        onPress={onSave}
        disabled={isPending}
        accessibilityRole="button"
        accessibilityLabel="Save Address"
        accessibilityState={{ disabled: isPending }}
      >
        {isPending ? (
          <ActivityIndicator size="small" color="#FFF" />
        ) : (
          <Text style={styles.saveButtonText}>Save Address</Text>
        )}
      </Pressable>
    </View>
  );
}
