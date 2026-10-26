import Ionicons from '@react-native-vector-icons/ionicons';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { loginStepStyles as styles } from '@/components/auth/LoginStep.styles';
import { GoogleLogo } from '@/components/icons/GoogleLogo';
import {
  PRIVACY_POLICY_URL,
  TERMS_OF_SERVICE_URL,
} from '@/components/settings/constants';
import type Colors from '@/constants/Colors';
import { TextContentTypes } from '@/hooks/use-keyboard';

export type LoginAuthMethod = 'otp' | 'password';

type LoginColors = (typeof Colors)['light'];

interface LoginEmailStepProps {
  authMethod: LoginAuthMethod;
  colors: LoginColors;
  email: string;
  emailError: string | null;
  isAppleLoading: boolean;
  isGoogleLoading: boolean;
  isLoading: boolean;
  onAppleSignIn: () => void;
  onContinue: () => void;
  onEmailChange: (text: string) => void;
  onGoogleSignIn: () => void;
  onToggleAuthMethod: () => void;
}

export function LoginEmailStep({
  authMethod,
  colors,
  email,
  emailError,
  isAppleLoading,
  isGoogleLoading,
  isLoading,
  onAppleSignIn,
  onContinue,
  onEmailChange,
  onGoogleSignIn,
  onToggleAuthMethod,
}: LoginEmailStepProps) {
  const isAnyLoading = isLoading || isGoogleLoading || isAppleLoading;

  return (
    <>
      <Text style={[styles.title, { color: colors.text }]}>Welcome Back</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Enter your email to receive a verification code
      </Text>

      <View style={styles.inputGroup}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          Email Address
        </Text>
        <View
          style={[
            styles.inputContainer,
            {
              backgroundColor: colors.muted,
              borderColor: emailError ? colors.error : colors.border,
            },
          ]}
        >
          <Ionicons
            name="mail-outline"
            size={20}
            color={emailError ? colors.error : colors.textSecondary}
          />
          <TextInput
            accessibilityLabel="Email address"
            style={[styles.input, { color: colors.text }]}
            placeholder="john@example.com"
            placeholderTextColor={colors.placeholder}
            value={email}
            onChangeText={onEmailChange}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isAnyLoading}
            textContentType={TextContentTypes.emailAddress}
            autoComplete="email"
            returnKeyType="go"
            onSubmitEditing={onContinue}
            blurOnSubmit={false}
          />
        </View>
        {emailError && (
          <Text style={[styles.errorText, { color: colors.error }]}>
            {emailError}
          </Text>
        )}
      </View>

      <Pressable
        style={[
          styles.primaryButton,
          { backgroundColor: colors.primary },
          isAnyLoading && styles.buttonDisabled,
        ]}
        onPress={onContinue}
        disabled={isAnyLoading}
        accessibilityLabel={
          authMethod === 'otp' ? 'Continue with Code' : 'Continue with Password'
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: isAnyLoading, busy: isLoading }}
      >
        {isLoading ? (
          <ActivityIndicator
            accessibilityLabel="Signing in"
            color={colors.primaryForeground}
          />
        ) : (
          <Text
            style={[
              styles.primaryButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            {authMethod === 'otp'
              ? 'Continue with Code'
              : 'Continue with Password'}
          </Text>
        )}
      </Pressable>

      <Pressable onPress={onToggleAuthMethod} style={styles.methodToggle}>
        <Text style={[styles.methodToggleText, { color: colors.primary }]}>
          {authMethod === 'otp'
            ? 'Use password instead'
            : 'Use verification code instead'}
        </Text>
      </Pressable>

      <View style={styles.divider}>
        <View
          style={[styles.dividerLine, { backgroundColor: colors.border }]}
        />
        <Text style={[styles.dividerText, { color: colors.textSecondary }]}>
          or
        </Text>
        <View
          style={[styles.dividerLine, { backgroundColor: colors.border }]}
        />
      </View>

      <View style={styles.socialContainer}>
        <Pressable
          style={[
            styles.socialButton,
            { borderColor: colors.border, flex: 1 },
            isAnyLoading && styles.buttonDisabled,
          ]}
          onPress={onGoogleSignIn}
          disabled={isAnyLoading}
          accessibilityLabel="Continue with Google"
          accessibilityRole="button"
          accessibilityState={{
            disabled: isAnyLoading,
            busy: isGoogleLoading,
          }}
        >
          {isGoogleLoading ? (
            <ActivityIndicator
              accessibilityLabel="Signing in with Google"
              size="small"
              color={colors.text}
            />
          ) : (
            <>
              <GoogleLogo size={20} />
              <Text style={[styles.socialButtonText, { color: colors.text }]}>
                Google
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          style={[
            styles.socialButton,
            { borderColor: colors.border, flex: 1 },
            isAnyLoading && styles.buttonDisabled,
          ]}
          onPress={onAppleSignIn}
          disabled={isAnyLoading}
          accessibilityLabel="Continue with Apple"
          accessibilityRole="button"
          accessibilityState={{
            disabled: isAnyLoading,
            busy: isAppleLoading,
          }}
        >
          {isAppleLoading ? (
            <ActivityIndicator
              accessibilityLabel="Signing in with Apple"
              size="small"
              color={colors.text}
            />
          ) : (
            <>
              <Ionicons name="logo-apple" size={22} color={colors.text} />
              <Text style={[styles.socialButtonText, { color: colors.text }]}>
                Apple
              </Text>
            </>
          )}
        </Pressable>
      </View>

      <Text style={[styles.termsText, { color: colors.textSecondary }]}>
        By continuing, you agree to our{' '}
        <Text
          accessible
          accessibilityRole="link"
          accessibilityLabel="Open terms of service"
          onPress={() => Linking.openURL(TERMS_OF_SERVICE_URL)}
          style={[styles.link, { color: colors.primary }]}
        >
          Terms of Service
        </Text>{' '}
        and{' '}
        <Text
          accessible
          accessibilityRole="link"
          accessibilityLabel="Open privacy policy"
          onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
          style={[styles.link, { color: colors.primary }]}
        >
          Privacy Policy
        </Text>
      </Text>
    </>
  );
}
