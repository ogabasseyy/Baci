import Ionicons from '@react-native-vector-icons/ionicons';
import { Text, TextInput, View } from 'react-native';
import type { BusinessTypeId } from '@/constants/business-types';
import { useTheme } from '@/hooks/useTheme';
import { BusinessTypeSelector } from '../BusinessTypeSelector';
import { MerchantSetupActionButton } from './MerchantSetupActionButton';
import { MerchantSetupHero } from './MerchantSetupHero';
import { getMerchantSetupStyles } from './merchant-setup.styles';
import { RegisterLegalText } from './RegisterLegalText';
import { getStyles } from './register.styles';

interface RegisterFormData {
  businessName: string;
  businessType: string;
  otherBusinessType: string;
  slug: string;
}

interface RegisterBusinessStepProps {
  firstName: string;
  formData: RegisterFormData;
  isLoading: boolean;
  onBack?: () => void;
  onBusinessTypeChange: (typeId: BusinessTypeId) => void;
  onLaunchStore: () => void;
  onOtherBusinessTypeChange: (text: string) => void;
  onBusinessNameChange: (text: string) => void;
  onSlugChange: (text: string) => void;
  slugError?: string | null;
}

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|[\s'’-])\S/g, (match) => match.toUpperCase());
}

export function RegisterBusinessStep({
  firstName,
  formData,
  isLoading,
  onBack,
  onBusinessNameChange,
  onBusinessTypeChange,
  onLaunchStore,
  onOtherBusinessTypeChange,
  onSlugChange,
  slugError,
}: RegisterBusinessStepProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const setupStyles = getMerchantSetupStyles(colors);

  return (
    <View style={styles.formSection}>
      <MerchantSetupHero
        firstName={firstName}
        onBack={onBack}
        step="business"
      />
      <View style={setupStyles.formCard}>
        <View style={setupStyles.formCardHeader}>
          <View style={setupStyles.formCardIcon}>
            <Ionicons
              color={colors.primary}
              name="storefront-outline"
              size={21}
            />
          </View>
          <View style={setupStyles.formCardHeadingGroup}>
            <Text style={setupStyles.formCardTitle}>Store identity</Text>
            <Text style={setupStyles.formCardSubtitle}>
              Choose how customers will find you
            </Text>
          </View>
        </View>
        <View style={setupStyles.cardFields}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Business Name</Text>
            <TextInput
              accessibilityLabel="Business Name"
              autoCapitalize="words"
              onChangeText={(text) => onBusinessNameChange(toTitleCase(text))}
              placeholder="My Awesome Store"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={formData.businessName}
            />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Store Link</Text>
            <View style={styles.urlInputContainer}>
              <TextInput
                accessibilityLabel="Store Link"
                autoCapitalize="none"
                onChangeText={onSlugChange}
                placeholder="my-store"
                placeholderTextColor={colors.textMuted}
                style={[styles.urlInput, { textAlign: 'right' }]}
                value={formData.slug}
              />
              <Text style={styles.urlSuffix}>.usebaci.com</Text>
            </View>
            {slugError ? (
              <Text style={styles.errorText}>{slugError}</Text>
            ) : null}
          </View>
        </View>
      </View>
      <View style={setupStyles.formCard}>
        <View style={setupStyles.formCardHeader}>
          <View style={setupStyles.formCardIcon}>
            <Ionicons color={colors.primary} name="grid-outline" size={21} />
          </View>
          <View style={setupStyles.formCardHeadingGroup}>
            <Text style={setupStyles.formCardTitle}>Business category</Text>
            <Text style={setupStyles.formCardSubtitle}>
              We will tailor your tools and suggestions
            </Text>
          </View>
        </View>
        <View style={styles.inputGroup}>
          <Text style={styles.label}>Choose one</Text>
          <BusinessTypeSelector
            borderColor={colors.border}
            cardBackgroundColor={colors.inputBg}
            onSelect={onBusinessTypeChange}
            selectedBackgroundColor={colors.primaryLight}
            selectedBorderColor={colors.primary}
            selectedTextColor={colors.text}
            selectedType={formData.businessType}
            textColor={colors.textSecondary}
          />
        </View>
        {formData.businessType === 'other' ? (
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Please specify</Text>
            <TextInput
              accessibilityLabel="Please specify"
              onChangeText={onOtherBusinessTypeChange}
              placeholder="e.g. Pet Supplies"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              value={formData.otherBusinessType}
            />
          </View>
        ) : null}
      </View>
      <MerchantSetupActionButton
        icon="rocket-outline"
        isLoading={isLoading}
        label="Launch Store"
        loadingLabel="Launching store..."
        onPress={onLaunchStore}
      />
      <RegisterLegalText prefixText="By creating an account, you agree to our" />
    </View>
  );
}
