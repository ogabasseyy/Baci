import Ionicons from '@react-native-vector-icons/ionicons';
import type { RefObject } from 'react';
import type { TextInputInstance } from 'react-native';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type Colors from '@/constants/Colors';
import { TextContentTypes } from '@/hooks/use-keyboard';
import { EmailSchema, getFirstError } from '@/lib/validation';
import type { LoginAuthMethod } from './LoginEmailStep';
import { loginStepStyles } from './LoginStep.styles';

type ColorsScheme = (typeof Colors)['light'];
type AuthStep = 'email' | 'otp' | 'password';

interface LoginPasswordStepProps {
  colors: ColorsScheme;
  email: string;
  handlePasswordSignIn: () => void;
  isLoading: boolean;
  otpInputRef: RefObject<TextInputInstance | null>;
  password: string;
  passwordError: string | null;
  setAuthMethod: (value: LoginAuthMethod) => void;
  setEmailError: (value: string | null) => void;
  setPassword: (value: string) => void;
  setPasswordError: (value: string | null) => void;
  setStep: (value: AuthStep) => void;
  showPassword: boolean;
  signInWithOtp: (
    email: string
  ) => Promise<{ error?: string; success: boolean }>;
  toggleShowPassword: () => void;
}

export function LoginPasswordStep({
  colors,
  email,
  handlePasswordSignIn,
  isLoading,
  otpInputRef,
  password,
  passwordError,
  setAuthMethod,
  setEmailError,
  setPassword,
  setPasswordError,
  setStep,
  showPassword,
  signInWithOtp,
  toggleShowPassword,
}: LoginPasswordStepProps) {
  const switchToOtp = async () => {
    setAuthMethod('otp');
    const emailResult = EmailSchema.safeParse(email.trim());
    const error = getFirstError(emailResult);
    if (error) {
      setEmailError(error);
      setStep('email');
      return;
    }
    setEmailError(null);
    const result = await signInWithOtp(email.toLowerCase().trim());
    if (result.success) {
      setStep('otp');
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } else {
      setStep('email');
      Alert.alert('Error', result.error || 'Failed to send verification code');
    }
  };

  return (
    <>
      <Text style={[loginStepStyles.title, { color: colors.text }]}>
        Enter Password
      </Text>
      <Text style={[loginStepStyles.subtitle, { color: colors.textSecondary }]}>
        Sign in with your password for {email}
      </Text>

      <View style={loginStepStyles.inputGroup}>
        <Text style={[loginStepStyles.label, { color: colors.textSecondary }]}>
          Password
        </Text>
        <View
          style={[
            loginStepStyles.inputContainer,
            {
              backgroundColor: colors.muted,
              borderColor: passwordError ? colors.error : colors.border,
            },
          ]}
        >
          <Ionicons
            name="lock-closed-outline"
            size={20}
            color={passwordError ? colors.error : colors.textSecondary}
          />
          <TextInput
            style={[loginStepStyles.input, { color: colors.text }]}
            placeholder="••••••••"
            placeholderTextColor={colors.placeholder}
            value={password}
            onChangeText={(text) => {
              setPassword(text);
              if (passwordError) setPasswordError(null);
            }}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            textContentType={TextContentTypes.password}
            autoComplete="password"
            returnKeyType="done"
            onSubmitEditing={handlePasswordSignIn}
          />
          <Pressable
            onPress={toggleShowPassword}
            accessibilityLabel={
              showPassword ? 'Hide password' : 'Show password'
            }
            accessibilityRole="button"
            style={({ pressed }) => [
              loginStepStyles.passwordToggle,
              pressed && loginStepStyles.pressablePressed,
            ]}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        </View>
        {passwordError && (
          <Text style={[loginStepStyles.errorText, { color: colors.error }]}>
            {passwordError}
          </Text>
        )}
      </View>

      <Pressable
        style={[
          loginStepStyles.primaryButton,
          { backgroundColor: colors.primary },
          isLoading && loginStepStyles.buttonDisabled,
        ]}
        onPress={handlePasswordSignIn}
        disabled={isLoading}
        accessibilityLabel={isLoading ? 'Signing in' : 'Sign In'}
        accessibilityRole="button"
        accessibilityState={{ disabled: isLoading, busy: isLoading }}
      >
        {isLoading ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text
            style={[
              loginStepStyles.primaryButtonText,
              { color: colors.primaryForeground },
            ]}
          >
            Sign In
          </Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => void switchToOtp()}
        style={loginStepStyles.methodToggle}
      >
        <Text
          style={[loginStepStyles.methodToggleText, { color: colors.primary }]}
        >
          Sign in with verification code instead
        </Text>
      </Pressable>
    </>
  );
}
