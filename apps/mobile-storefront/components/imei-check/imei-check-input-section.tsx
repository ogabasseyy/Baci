import type { ImeiIdentifierType } from '@baci/shared/imei';
import { isValidDeviceIdentifier } from '@baci/shared/imei';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { BRAND, withAlpha } from '@/constants/Colors';
import { styles } from './imei-check.styles';
import type { ImeiCheckerColors } from './imei-check.types';

interface ImeiCheckInputSectionProps {
  colors: ImeiCheckerColors;
  error: string | null;
  identifier: ImeiIdentifierType;
  imei: string;
  onChangeImei: (value: string) => void;
  onCheck: () => void;
  onClearImei: () => void;
}

export function ImeiCheckInputSection({
  colors,
  error,
  identifier,
  imei,
  onChangeImei,
  onCheck,
  onClearImei,
}: ImeiCheckInputSectionProps) {
  const isImeiOnly = identifier === 'imei';
  const placeholder =
    identifier === 'serial'
      ? 'Enter serial number'
      : isImeiOnly
        ? 'Enter 15-digit IMEI'
        : 'Enter IMEI or serial';
  const isComplete = isValidDeviceIdentifier(imei, identifier);
  // Red while typing (like the sign-in field), and once a full number is in.
  const [isFocused, setIsFocused] = useState(false);
  const isActive = isFocused || isComplete;
  const countText = isImeiOnly ? `${imei.length}/15` : `${imei.length}`;
  // Durable accessible name: the placeholder disappears once text is entered,
  // so screen readers still need to know what this field is for.
  const inputAccessibilityLabel =
    identifier === 'serial'
      ? 'Serial number'
      : isImeiOnly
        ? 'IMEI number'
        : 'IMEI or serial number';

  return (
    <>
      {error ? (
        <View
          style={[
            styles.errorContainer,
            {
              backgroundColor: withAlpha(colors.error, 0.12),
              borderColor: withAlpha(colors.error, 0.3),
            },
          ]}
        >
          <Ionicons name="alert-circle" size={18} color={colors.error} />
          <Text style={[styles.errorText, { color: colors.error }]}>
            {error}
          </Text>
        </View>
      ) : null}

      <View
        testID="imei-input-field"
        style={[
          styles.inputField,
          {
            backgroundColor: colors.muted,
            borderColor: isActive ? BRAND.primary : colors.border,
          },
        ]}
      >
        <Ionicons
          name="barcode-outline"
          size={20}
          color={isActive ? BRAND.primary : colors.textSecondary}
        />
        {/* No maxLength on purpose: it truncates a pasted spaced IMEI (e.g.
            "35 4442 067957 452") to 15 chars *including spaces* before the
            spaces are stripped, dropping digits. normalizeDeviceIdentifier caps
            the length after removing non-digits instead. */}
        <TextInput
          accessibilityLabel={inputAccessibilityLabel}
          style={[styles.imeiInput, { color: colors.text }]}
          value={imei}
          onChangeText={onChangeImei}
          placeholder={placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={isImeiOnly ? 'number-pad' : 'default'}
          autoCapitalize="characters"
          autoCorrect={false}
          // Number pads have no return-key row, so iOS floats a "Go" pill
          // above the keys when returnKeyType is set — it inflates the
          // reported keyboard frame (extra gap under the footer) and the
          // Verify button is the submit affordance anyway. The full keyboard
          // (serial input) keeps "go" as a normal return key.
          returnKeyType={isImeiOnly ? undefined : 'go'}
          onSubmitEditing={onCheck}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          autoComplete="off"
        />
        <Text
          style={[
            styles.imeiCount,
            { color: isComplete ? BRAND.primary : colors.textSecondary },
          ]}
        >
          {countText}
        </Text>
        {imei.length > 0 && (
          <Pressable
            accessible={true}
            accessibilityHint="Clears the input"
            accessibilityLabel="Clear input"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onClearImei}
          >
            <Ionicons
              name="close-circle"
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      </View>
    </>
  );
}
