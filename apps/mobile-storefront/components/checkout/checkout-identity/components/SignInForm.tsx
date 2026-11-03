import type { TextInputInstance } from 'react-native';
/**
 * SignInForm Component
 *
 * 2026 Best Practices:
 * - Modular architecture with separated concerns
 * - React Hook Form + Zod for form handling
 * - Custom hook for business logic
 * - Composable UI components
 * - Full accessibility support
 */

import { useRef } from 'react';
import type { CheckoutIdentityTheme } from '../colors';
import { useSignInForm } from '../hooks';
import type { SignInFormProps } from '../types';
import { EmailInput } from './EmailInput';
import { ErrorAlert } from './ErrorAlert';
import { PasswordInput } from './PasswordInput';
import { SocialSignInButtons } from './SocialSignInButtons';
import { SubmitButton } from './SubmitButton';

interface ThemedSignInFormProps extends SignInFormProps {
  theme: CheckoutIdentityTheme;
}

/**
 * Sign-in form with email/password and social authentication
 *
 * Composed of modular sub-components:
 * - ErrorAlert: Error message display
 * - EmailInput: Email input with validation
 * - PasswordInput: Password input with visibility toggle
 * - SubmitButton: Primary action button
 * - SocialSignInButtons: Google/Apple sign-in
 */
export function SignInForm({
  onSuccess,
  showSocialButtons = true,
  theme,
}: ThemedSignInFormProps) {
  const passwordInputRef = useRef<TextInputInstance>(null);
  const {
    control,
    errors,
    isLoading,
    error,
    handleSignIn,
    handleGoogleSignIn,
    handleAppleSignIn,
    handleForgotPassword,
    clearError,
  } = useSignInForm({ onSuccess });

  return (
    <>
      {/* Error Message */}
      <ErrorAlert error={error} theme={theme} />

      {/* Email Input */}
      <EmailInput
        control={control}
        errors={errors}
        isLoading={isLoading}
        onClearError={clearError}
        returnKeyType="next"
        onSubmitEditing={() => passwordInputRef.current?.focus()}
        theme={theme}
      />

      {/* Password Input */}
      <PasswordInput
        control={control}
        errors={errors}
        isLoading={isLoading}
        onClearError={clearError}
        onForgotPassword={handleForgotPassword}
        inputRef={passwordInputRef}
        returnKeyType="go"
        onSubmitEditing={handleSignIn}
        theme={theme}
      />

      {/* Submit Button */}
      <SubmitButton
        isLoading={isLoading}
        onPress={handleSignIn}
        theme={theme}
      />

      {/* Social Sign-In */}
      {showSocialButtons && (
        <SocialSignInButtons
          isLoading={isLoading}
          onGoogleSignIn={handleGoogleSignIn}
          onAppleSignIn={handleAppleSignIn}
          theme={theme}
        />
      )}
    </>
  );
}
