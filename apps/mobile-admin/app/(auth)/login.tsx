import Ionicons from '@react-native-vector-icons/ionicons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  ActivityIndicator,
  Pressable,
  StatusBar,
  Text,
  View,
} from 'react-native';
import { AuthInput } from '@/components/auth/AuthInput';
import { LoginSecondaryActions } from '@/components/auth/LoginSecondaryActions';
import { styles } from '@/components/auth/login.styles';
import { PasswordVisibilityToggle } from '@/components/auth/PasswordVisibilityToggle';
import { BaciLogo } from '@/components/BaciLogo';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { isRuntimePlatform } from '@/config/runtime-platform';
import { useOnboarding } from '@/context/OnboardingContext';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { getEmailError } from '@/lib/sanitize';

export default function LoginScreen() {
  // 2026 Best Practice: Destructure for React Compiler stable refs
  const { push, replace } = useRouter();
  const { colors, isDark } = useTheme();
  const {
    activeAuthProvider,
    isAuthenticating,
    signIn,
    signInWithApple,
    signInWithGoogle,
  } = useAuth();
  const { resetOnboarding } = useOnboarding();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<TextInputInstance>(null);

  const handleGoogleSignIn = async () => {
    setError(null);

    const result = await signInWithGoogle();
    if (result.error) {
      setError(result.error);
    }
  };

  const handleAppleSignIn = async () => {
    setError(null);

    const result = await signInWithApple();
    if (result.error) {
      setError(result.error);
    }
  };

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setError('Please enter both email and password');
      return;
    }

    // Validate email format using Zod schema
    const emailError = getEmailError(email.trim());
    if (emailError) {
      setError(emailError);
      return;
    }

    setError(null);

    const result = await signIn(email.trim(), password);
    if (result.error) {
      setError(
        result.error === 'Invalid login credentials'
          ? 'Incorrect email or password'
          : result.error
      );
    }
  };

  const isPasswordLoading =
    isAuthenticating && activeAuthProvider === 'password';
  const isGoogleLoading = isAuthenticating && activeAuthProvider === 'google';
  const isAppleLoading = isAuthenticating && activeAuthProvider === 'apple';
  const isAnyLoading = isAuthenticating;

  return (
    <AppFormScreen
      contentContainerStyle={styles.content}
      scrollEnabled={false}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <View style={styles.contentContainer}>
        {/* Baci Branding */}
        <View style={styles.header}>
          <BaciLogo size={80} borderRadius={20} />
          <Text style={[styles.title, { color: colors.text }]}>Baci</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            Manage your store on the go
          </Text>
        </View>

        {/* Form */}
        <View style={styles.form}>
          {error ? (
            <View
              style={[styles.errorCard, { backgroundColor: colors.errorLight }]}
            >
              <Ionicons name="alert-circle" size={20} color={colors.error} />
              <Text style={[styles.errorText, { color: colors.error }]}>
                {error}
              </Text>
            </View>
          ) : null}

          <AuthInput
            autoCapitalize="none"
            autoComplete="email"
            blurOnSubmit={false}
            borderColor={colors.border}
            editable={!isAnyLoading}
            iconColor={colors.textMuted}
            iconName="mail-outline"
            keyboardType="email-address"
            label="Email"
            labelColor={colors.textSecondary}
            onChangeText={setEmail}
            onSubmitEditing={() => passwordRef.current?.focus()}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            returnKeyType="next"
            textColor={colors.text}
            textContentType="emailAddress"
            value={email}
            wrapperColor={colors.card}
          />

          <AuthInput
            autoComplete="password"
            borderColor={colors.border}
            editable={!isAnyLoading}
            iconColor={colors.textMuted}
            iconName="lock-closed-outline"
            inputRef={passwordRef}
            label="Password"
            labelColor={colors.textSecondary}
            onChangeText={setPassword}
            onSubmitEditing={handleLogin}
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            returnKeyType="go"
            rightAccessory={
              <PasswordVisibilityToggle
                accessibilityLabel={
                  showPassword ? 'Hide password' : 'Show password'
                }
                iconColor={colors.textMuted}
                iconName={showPassword ? 'eye-off-outline' : 'eye-outline'}
                onPress={() => setShowPassword((prev) => !prev)}
              />
            }
            secureTextEntry={!showPassword}
            textColor={colors.text}
            textContentType="password"
            value={password}
            wrapperColor={colors.card}
          />
          <Pressable
            onPress={() => {
              if (isAnyLoading) {
                return;
              }

              push('/(auth)/forgot-password');
            }}
            style={styles.forgotPassword}
            disabled={isAnyLoading}
            accessibilityRole="link"
            accessibilityLabel="Forgot password? Reset your password"
            accessibilityState={{ disabled: isAnyLoading }}
          >
            <Text style={[styles.forgotPasswordText, { color: colors.gold }]}>
              Forgot Password?
            </Text>
          </Pressable>

          <Pressable
            style={[
              styles.loginButton,
              { backgroundColor: colors.gold },
              isAnyLoading && styles.loginButtonDisabled,
            ]}
            onPress={handleLogin}
            disabled={isAnyLoading}
            accessibilityRole="button"
            accessibilityLabel={
              isPasswordLoading ? 'Signing in' : 'Sign in to your account'
            }
            accessibilityState={{ disabled: isAnyLoading, busy: isAnyLoading }}
          >
            {isPasswordLoading ? (
              <ActivityIndicator color={colors.textOnGold} />
            ) : (
              <Text
                style={[styles.loginButtonText, { color: colors.textOnGold }]}
              >
                Sign In
              </Text>
            )}
          </Pressable>

          <LoginSecondaryActions
            colors={{
              border: colors.border,
              card: colors.card,
              text: colors.text,
              textMuted: colors.textMuted,
              gold: colors.gold,
              warning: colors.warning,
              warningLight: colors.warningLight,
            }}
            isAnyLoading={isAnyLoading}
            isAppleLoading={isAppleLoading}
            isGoogleLoading={isGoogleLoading}
            onAppleSignIn={handleAppleSignIn}
            onGoogleSignIn={handleGoogleSignIn}
            onResetOnboarding={resetOnboarding}
            onSignUp={() => push('/(auth)/register')}
            replace={replace}
            showAppleSignIn={isRuntimePlatform('ios')}
          />
        </View>
      </View>
    </AppFormScreen>
  );
}
