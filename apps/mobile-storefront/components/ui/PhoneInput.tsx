import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import {
  Platform,
  Text,
  TextInput,
  type TextInputProps,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { COUNTRIES, type Country } from './PhoneInput.countries';
import { phoneInputStyles as styles } from './PhoneInput.styles';
import { PhoneInputCountryPicker } from './PhoneInputCountryPicker';

interface PhoneInputProps
  extends Omit<TextInputProps, 'value' | 'onChangeText'> {
  value?: string;
  onChangeText?: (value: string) => void;
  defaultCountry?: string; // ISO code
  containerStyle?: ViewStyle;
  error?: string;
  label?: string;
  returnKeyType?: TextInputProps['returnKeyType'];
}

export function PhoneInput({
  value = '',
  onChangeText,
  defaultCountry = 'NG',
  containerStyle,
  error,
  label,
  returnKeyType = 'next',
  placeholder = '8012345678',
  ...props
}: PhoneInputProps) {
  const [selectedCountry, setSelectedCountry] = useState<Country>(
    COUNTRIES.find((c) => c.code === defaultCountry) || COUNTRIES[0]
  );
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const isDark = (colorScheme ?? 'light') === 'dark';

  // Extract the local number from the full value
  const getLocalNumber = () => {
    if (!value) return '';
    // Remove country code if present
    if (value.startsWith(selectedCountry.dialCode)) {
      return value.slice(selectedCountry.dialCode.length);
    }
    // Remove + prefix and dial code without +
    const dialWithoutPlus = selectedCountry.dialCode.replace('+', '');
    if (value.startsWith(`+${dialWithoutPlus}`)) {
      return value.slice(dialWithoutPlus.length + 1);
    }
    if (value.startsWith(dialWithoutPlus)) {
      return value.slice(dialWithoutPlus.length);
    }
    return value;
  };

  const handlePhoneChange = (text: string) => {
    // Sanitize: only digits
    let cleaned = text.replace(/[^0-9]/g, '');

    if (selectedCountry.code === 'NG') {
      // The input displays only the national number, but users commonly paste
      // the complete +234/234 or 00 234 form. Strip that prefix before the
      // controlled value is rebuilt so the country code is not duplicated.
      if (cleaned.startsWith('00234')) {
        cleaned = cleaned.slice(5);
      } else if (cleaned.startsWith('234')) {
        cleaned = cleaned.slice(3);
      }
      if (cleaned.startsWith('0')) {
        cleaned = cleaned.slice(1);
      }
      cleaned = cleaned.slice(0, 10);
    }

    // Prepend country code
    const fullNumber = cleaned ? `${selectedCountry.dialCode}${cleaned}` : '';
    onChangeText?.(fullNumber);
  };

  const handleCountrySelect = (country: Country) => {
    setSelectedCountry(country);
    setShowCountryPicker(false);
    setSearchQuery('');
    // Re-format number with new country code
    const localNum = getLocalNumber();
    if (localNum) {
      onChangeText?.(`${country.dialCode}${localNum}`);
    }
  };

  const filteredCountries = searchQuery
    ? COUNTRIES.filter(
        (c) =>
          c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.dialCode.includes(searchQuery)
      )
    : COUNTRIES;

  return (
    <View style={containerStyle}>
      {label && (
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
      )}

      <View
        style={[
          styles.container,
          {
            backgroundColor: isDark
              ? 'rgba(255, 255, 255, 0.05)'
              : colors.muted,
            borderColor: error ? colors.error : colors.border,
          },
          error && styles.containerError,
        ]}
      >
        {/* Country Selector Button */}
        <TouchableOpacity
          style={styles.countryButton}
          onPress={() => setShowCountryPicker(true)}
          accessibilityRole="button"
          accessibilityLabel={`Select country. Current: ${selectedCountry.name}`}
          accessibilityHint="Opens a modal to select a different country code"
          activeOpacity={0.7}
        >
          <Text
            style={styles.flag}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {selectedCountry.flag}
          </Text>
          <Ionicons
            name="chevron-down"
            size={14}
            color={colors.textSecondary}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
        </TouchableOpacity>

        {/* Divider */}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />

        {/* Country Code Display */}
        <Text style={[styles.dialCode, { color: colors.text }]}>
          {selectedCountry.dialCode}
        </Text>

        {/* Phone Input */}
        <TextInput
          style={[styles.input, { color: colors.text }]}
          value={getLocalNumber()}
          onChangeText={handlePhoneChange}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          accessibilityLabel={label || 'Phone number'}
          // Allow a complete Nigerian number to be pasted; handlePhoneChange
          // canonicalizes it back to the ten-digit national value.
          maxLength={
            selectedCountry.code === 'NG'
              ? undefined
              : selectedCountry.maxLength || 15
          }
          returnKeyType={returnKeyType}
          {...props}
        />
      </View>

      {/* Error Message */}
      {error && (
        <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
      )}

      <PhoneInputCountryPicker
        colors={colors}
        countries={filteredCountries}
        isDark={isDark}
        onClose={() => {
          setShowCountryPicker(false);
          setSearchQuery('');
        }}
        onSelectCountry={handleCountrySelect}
        searchQuery={searchQuery}
        selectedCountry={selectedCountry}
        removeClippedSubviews={Platform.OS === 'android'}
        setSearchQuery={setSearchQuery}
        visible={showCountryPicker}
      />
    </View>
  );
}
