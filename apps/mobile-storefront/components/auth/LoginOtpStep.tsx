import Ionicons from '@react-native-vector-icons/ionicons';
import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
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
import { getFirstError, OtpSchema } from '@/lib/validation';
import { loginStepStyles } from './LoginStep.styles';

const RESEND_COOLDOWN_MS = 60_000;

type ColorsScheme = (typeof Colors)['light'];

interface LoginOtpStepProps {
  colors: ColorsScheme;
  dismissAndNavigate: () => void;
  email: string;
  isLoading: boolean;
  isMountedRef: RefObject<boolean>;
  isVerifyingRef: RefObject<boolean>;
  onResendOtp: () => Promise<boolean | undefined>;
  otp: string;
  otpError: string | null;
  otpInputRef: RefObject<TextInputInstance | null>;
  setOtp: (value: string) => void;
  setOtpError: (value: string | null) => void;
  verifyOtp: (
    email: string,
    token: string
  ) => Promise<{ error?: string; success: boolean }>;
}

interface RunOtpVerificationParams {
  dismissAndNavigate: () => void;
  email: string;
  isMountedRef: RefObject<boolean>;
  isVerifyingRef: RefObject<boolean>;
  token: string;
  verifyOtp: (
    email: string,
    token: string
  ) => Promise<{ error?: string; success: boolean }>;
}

// Module-scope helper: keeping the try/finally statement out of the component
// body lets React Compiler memoize LoginOtpStep.
async function runOtpVerification({
  dismissAndNavigate,
  email,
  isMountedRef,
  isVerifyingRef,
  token,
  verifyOtp,
}: RunOtpVerificationParams) {
  isVerifyingRef.current = true;
  try {
    const result = await verifyOtp(email.toLowerCase().trim(), token.trim());
    if (!isMountedRef.current) return;
    if (result.success) {
      dismissAndNavigate();
    } else {
      Alert.alert('Error', result.error || 'Invalid code');
    }
  } catch (verifyError) {
    // A rejected verifyOtp() must not escape as an unhandled rejection: the
    // call sites discard this promise with `void`, so handle it here.
    if (!isMountedRef.current) return;
    Alert.alert(
      'Error',
      verifyError instanceof Error
        ? verifyError.message
        : 'Unable to verify code. Please try again.'
    );
  } finally {
    isVerifyingRef.current = false;
  }
}

export function LoginOtpStep({
  colors,
  dismissAndNavigate,
  email,
  isLoading,
  isMountedRef,
  isVerifyingRef,
  onResendOtp,
  otp,
  otpError,
  otpInputRef,
  setOtp,
  setOtpError,
  verifyOtp,
}: LoginOtpStepProps) {
  const [resendAvailableAt, setResendAvailableAt] = useState(
    () => Date.now() + RESEND_COOLDOWN_MS
  );
  const [now, setNow] = useState(() => Date.now());
  const resendCooldownSeconds = Math.max(
    0,
    Math.ceil((resendAvailableAt - now) / 1000)
  );
  const isResendCoolingDown = resendCooldownSeconds > 0;

  useEffect(() => {
    if (!isResendCoolingDown) return;

    const intervalId = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(intervalId);
    };
  }, [isResendCoolingDown]);

  const submitOtp = async (token: string) => {
    if (isVerifyingRef.current) return;
    const otpResult = OtpSchema.safeParse(token.trim());
    const error = getFirstError(otpResult);
    if (error) {
      setOtpError(error);
      return;
    }
    setOtpError(null);
    await runOtpVerification({
      dismissAndNavigate,
      email,
      isMountedRef,
      isVerifyingRef,
      token,
      verifyOtp,
    });
  };

  const resendOtp = async () => {
    if (isResendCoolingDown || isLoading) return;

    const didSend = await onResendOtp();
    if (didSend === false) return;

    const nextAvailableAt = Date.now() + RESEND_COOLDOWN_MS;
    setNow(Date.now());
    setResendAvailableAt(nextAvailableAt);
  };

  return (
    <>
      <Text style={[loginStepStyles.title, { color: colors.text }]}>
        Verify Your Email
      </Text>
      <Text style={[loginStepStyles.subtitle, { color: colors.textSecondary }]}>
        We've sent a 6-digit verification code to{'\n'}
        <Text style={{ fontWeight: '600', color: colors.text }}>{email}</Text>
      </Text>

      <View style={loginStepStyles.inputGroup}>
        <Text style={[loginStepStyles.label, { color: colors.textSecondary }]}>
          Verification Code
        </Text>
        <View
          style={[
            loginStepStyles.inputContainer,
            {
              backgroundColor: colors.muted,
              borderColor: otpError ? colors.error : colors.border,
            },
          ]}
        >
          <Ionicons
            name="keypad-outline"
            size={20}
            color={otpError ? colors.error : colors.textSecondary}
          />
          <TextInput
            ref={otpInputRef}
            style={[
              loginStepStyles.input,
              loginStepStyles.otpInput,
              { color: colors.text },
            ]}
            placeholder="000000"
            placeholderTextColor={colors.placeholder}
            value={otp}
            onChangeText={(text) => {
              setOtp(text);
              if (otpError) setOtpError(null);
              if (text.length === 6) void submitOtp(text);
            }}
            keyboardType="number-pad"
            maxLength={6}
            editable={!isLoading}
            textContentType={TextContentTypes.oneTimeCode}
            autoComplete="one-time-code"
            returnKeyType="done"
          />
        </View>
        {otpError && (
          <Text style={[loginStepStyles.errorText, { color: colors.error }]}>
            {otpError}
          </Text>
        )}
      </View>

      <Pressable
        style={[
          loginStepStyles.primaryButton,
          { backgroundColor: colors.primary },
          isLoading && loginStepStyles.buttonDisabled,
        ]}
        onPress={() => void submitOtp(otp)}
        disabled={isLoading}
        accessibilityLabel={isLoading ? 'Verifying code' : 'Verify'}
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
            Verify
          </Text>
        )}
      </Pressable>

      <View style={loginStepStyles.resendContainer}>
        <Text
          style={[loginStepStyles.resendText, { color: colors.textSecondary }]}
        >
          Didn't receive the code?
        </Text>
        <Pressable
          onPress={() => void resendOtp()}
          disabled={isLoading || isResendCoolingDown}
          accessibilityLabel={
            isResendCoolingDown
              ? `Resend code in ${resendCooldownSeconds} seconds`
              : 'Resend code'
          }
          accessibilityRole="button"
          accessibilityState={{
            disabled: isLoading || isResendCoolingDown,
          }}
        >
          <Text style={[loginStepStyles.resendLink, { color: colors.primary }]}>
            {isResendCoolingDown
              ? `Resend in ${resendCooldownSeconds}s`
              : 'Resend'}
          </Text>
        </Pressable>
      </View>
    </>
  );
}
