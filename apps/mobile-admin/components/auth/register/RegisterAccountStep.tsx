import Ionicons from '@react-native-vector-icons/ionicons';
import { useRef } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import type { PasswordValidationResult } from '@/lib/password-utils';
import { PasswordVisibilityToggle } from '../PasswordVisibilityToggle';
import { MerchantSetupActionButton } from './MerchantSetupActionButton';
import { MerchantSetupHero } from './MerchantSetupHero';
import { getMerchantSetupStyles } from './merchant-setup.styles';
import { PasswordChecklist } from './PasswordChecklist';
import { PersonNameFields } from './PersonNameFields';
import { getStyles } from './register.styles';

interface RegisterFormData {
  confirmPassword: string;
  email: string;
  firstName: string;
  lastName: string;
  password: string;
}

interface RegisterAccountStepProps {
  confirmError: string | null;
  formData: RegisterFormData;
  isLoading?: boolean;
  onNext: () => void;
  passwordState: PasswordValidationResult;
  showPassword: boolean;
  updateForm: <K extends keyof RegisterFormData>(
    key: K,
    value: RegisterFormData[K]
  ) => void;
  onTogglePassword: () => void;
}

export function RegisterAccountStep({
  confirmError,
  formData,
  isLoading = false,
  onNext,
  passwordState,
  showPassword,
  updateForm,
  onTogglePassword,
}: RegisterAccountStepProps) {
  const { colors } = useTheme();
  const styles = getStyles(colors);
  const setupStyles = getMerchantSetupStyles(colors);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  return (
    <View style={styles.formSection}>
      <MerchantSetupHero step="owner" />
      <View style={setupStyles.formCard}>
        <View style={setupStyles.formCardHeader}>
          <View style={setupStyles.formCardIcon}>
            <Ionicons color={colors.primary} name="person-outline" size={21} />
          </View>
          <View style={setupStyles.formCardHeadingGroup}>
            <Text style={setupStyles.formCardTitle}>Your details</Text>
            <Text style={setupStyles.formCardSubtitle}>
              How we will identify your account
            </Text>
          </View>
        </View>
        <View style={setupStyles.cardFields}>
          <PersonNameFields
            firstName={formData.firstName}
            lastName={formData.lastName}
            onFirstNameChange={(value) => updateForm('firstName', value)}
            onLastNameChange={(value) => updateForm('lastName', value)}
            onLastSubmit={() => emailRef.current?.focus()}
          />

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              ref={emailRef}
              accessibilityLabel="Email Address"
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              textContentType="emailAddress"
              value={formData.email}
              onChangeText={(text) => updateForm('email', text)}
              returnKeyType="next"
              blurOnSubmit={false}
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>
        </View>
      </View>

      <View style={setupStyles.formCard}>
        <View style={setupStyles.formCardHeader}>
          <View style={setupStyles.formCardIcon}>
            <Ionicons
              color={colors.primary}
              name="lock-closed-outline"
              size={21}
            />
          </View>
          <View style={setupStyles.formCardHeadingGroup}>
            <Text style={setupStyles.formCardTitle}>Secure your account</Text>
            <Text style={setupStyles.formCardSubtitle}>
              Choose a password only you know
            </Text>
          </View>
        </View>
        <View style={setupStyles.cardFields}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                ref={passwordRef}
                accessibilityLabel="Password"
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                // Both password fields declare newPassword so iOS drives its
                // create-account AutoFill flow deterministically instead of
                // guessing from two adjacent secure fields — the guess is what
                // leaves the fields stuck under the yellow AutoFill highlight.
                // passwordRules keeps a generated password past validatePassword's
                // "complexity" rule, which needs 10+ characters.
                autoComplete="password-new"
                textContentType="newPassword"
                passwordRules="minlength: 10;"
                value={formData.password}
                onChangeText={(text) => updateForm('password', text)}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() => confirmPasswordRef.current?.focus()}
              />
              <PasswordVisibilityToggle
                accessibilityLabel={
                  showPassword ? 'Hide password' : 'Show password'
                }
                iconColor={colors.textSecondary}
                iconName={showPassword ? 'eye-off' : 'eye'}
                onPress={onTogglePassword}
              />
            </View>

            <PasswordChecklist
              passwordState={passwordState}
              passwordValue={formData.password}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <View style={styles.passwordContainer}>
              <TextInput
                ref={confirmPasswordRef}
                accessibilityLabel="Confirm Password"
                style={styles.passwordInput}
                placeholder="••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry={!showPassword}
                autoComplete="password-new"
                textContentType="newPassword"
                passwordRules="minlength: 10;"
                value={formData.confirmPassword}
                onChangeText={(text) => updateForm('confirmPassword', text)}
                returnKeyType="done"
                onSubmitEditing={onNext}
              />
              <PasswordVisibilityToggle
                accessibilityLabel={
                  showPassword ? 'Hide password' : 'Show password'
                }
                iconColor={colors.textSecondary}
                iconName={showPassword ? 'eye-off' : 'eye'}
                onPress={onTogglePassword}
              />
            </View>
            {confirmError ? (
              <Text style={styles.errorText}>{confirmError}</Text>
            ) : null}
          </View>
        </View>
      </View>

      <MerchantSetupActionButton
        accessibilityLabel="Proceed to next step"
        icon="arrow-forward"
        isLoading={isLoading}
        label="Continue"
        loadingLabel="Creating account..."
        onPress={onNext}
      />
    </View>
  );
}
