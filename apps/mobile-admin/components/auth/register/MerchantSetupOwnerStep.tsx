import { MERCHANT_COUNTRIES } from '@baci/shared';
import Ionicons from '@react-native-vector-icons/ionicons';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { CountryPickerModal } from '@/components/ui/CountryPickerModal';
import { useTheme } from '@/hooks/useTheme';
import {
  formatPhoneNumberForCountry,
  getNationalPhoneNumber,
} from '@/lib/phone-country';
import { MerchantSetupActionButton } from './MerchantSetupActionButton';
import { MerchantSetupHero } from './MerchantSetupHero';
import { getMerchantSetupStyles } from './merchant-setup.styles';
import { PersonNameFields } from './PersonNameFields';
import { getStyles } from './register.styles';

interface MerchantSetupOwnerStepProps {
  country: string;
  firstName: string;
  lastName: string;
  onContinue: () => void;
  onCountryChange: (value: string) => void;
  onFirstNameChange: (value: string) => void;
  onLastNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  phone: string;
  showNameFields?: boolean;
}

export function MerchantSetupOwnerStep({
  country,
  firstName,
  lastName,
  onContinue,
  onCountryChange,
  onFirstNameChange,
  onLastNameChange,
  onPhoneChange,
  phone,
  showNameFields = true,
}: MerchantSetupOwnerStepProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const setupStyles = getMerchantSetupStyles(colors);
  const [isCountryPickerVisible, setIsCountryPickerVisible] = useState(false);
  const selectedCountry =
    MERCHANT_COUNTRIES.find((option) => option.code === country) ??
    MERCHANT_COUNTRIES.find((option) => option.code === 'NG') ??
    MERCHANT_COUNTRIES[0];
  const nationalPhoneNumber = getNationalPhoneNumber(phone);

  const selectCountry = (countryCode: string) => {
    const nextCountry = MERCHANT_COUNTRIES.find(
      (option) => option.code === countryCode
    );
    if (!nextCountry) {
      return;
    }
    onCountryChange(nextCountry.code);
    onPhoneChange(
      formatPhoneNumberForCountry(nationalPhoneNumber, {
        callingCode: nextCountry.phoneCode.replace(/^\+/, ''),
      })
    );
    setIsCountryPickerVisible(false);
  };

  return (
    <>
      <MerchantSetupHero
        ownerFocus={showNameFields ? 'identity' : 'location'}
        step="owner"
      />
      <View style={setupStyles.formCard}>
        <View style={setupStyles.formCardHeader}>
          <View style={setupStyles.formCardIcon}>
            <Ionicons color={colors.primary} name="person-outline" size={21} />
          </View>
          <View style={setupStyles.formCardHeadingGroup}>
            <Text style={setupStyles.formCardTitle}>
              {showNameFields ? 'Owner Details' : 'Your location'}
            </Text>
            <Text style={setupStyles.formCardSubtitle}>
              {showNameFields
                ? 'Required for your merchant profile'
                : 'Sets your store currency and payment options'}
            </Text>
          </View>
        </View>
        <View style={setupStyles.cardFields}>
          {showNameFields ? (
            <PersonNameFields
              firstName={firstName}
              lastName={lastName}
              onFirstNameChange={onFirstNameChange}
              onLastNameChange={onLastNameChange}
            />
          ) : null}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Country / Region</Text>
            <View style={styles.countrySelector}>
              <Pressable
                accessibilityLabel={`Country / Region, ${selectedCountry.name}`}
                accessibilityRole="button"
                onPress={() => setIsCountryPickerVisible(true)}
                style={styles.countrySelectorPressable}
              >
                <View style={styles.countrySelectorValue}>
                  <Text style={styles.countrySelectorFlag}>
                    {selectedCountry.flag}
                  </Text>
                  <Text style={styles.countrySelectorText}>
                    {selectedCountry.name}
                  </Text>
                </View>
                <Ionicons
                  color={colors.textSecondary}
                  name="chevron-down"
                  size={20}
                />
              </Pressable>
            </View>
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>
              Phone Number{showNameFields ? '' : ' (Optional)'}
            </Text>
            <View style={styles.phoneField}>
              <Pressable
                accessibilityLabel={`Select phone country, currently ${selectedCountry.name}`}
                accessibilityRole="button"
                onPress={() => setIsCountryPickerVisible(true)}
                style={styles.phoneCountryButton}
              >
                <Text style={styles.countrySelectorFlag}>
                  {selectedCountry.flag}
                </Text>
                <Text style={styles.phoneCountryCode}>
                  {selectedCountry.phoneCode}
                </Text>
              </Pressable>
              <View style={styles.phoneFieldDivider} />
              <TextInput
                accessibilityLabel={
                  showNameFields ? 'Phone Number' : 'Phone Number (Optional)'
                }
                keyboardType="phone-pad"
                onChangeText={(value) =>
                  onPhoneChange(
                    formatPhoneNumberForCountry(value, {
                      callingCode: selectedCountry.phoneCode.replace(/^\+/, ''),
                    })
                  )
                }
                placeholder="Mobile Phone"
                placeholderTextColor={colors.textMuted}
                style={styles.phoneInput}
                value={nationalPhoneNumber}
              />
            </View>
          </View>
        </View>
      </View>
      <MerchantSetupActionButton
        accessibilityLabel="Continue to business info"
        icon="arrow-forward"
        label="Continue"
        onPress={onContinue}
      />
      <CountryPickerModal
        countries={MERCHANT_COUNTRIES}
        onClose={() => setIsCountryPickerVisible(false)}
        onSelect={(option) => selectCountry(option.code)}
        selectedCountry={selectedCountry.code}
        visible={isCountryPickerVisible}
      />
    </>
  );
}
