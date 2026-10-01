import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getVerifyStyles } from '@/components/auth/verify.styles';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';

const OTP_KEYS = Array.from({ length: 6 }, (_, index) => `otp-${index}`);
const LAST_OTP_INDEX = OTP_KEYS.length - 1;

async function resendSignupOtp(email: string): Promise<string | null> {
  try {
    const { error } = await supabase.auth.resend({ email, type: 'signup' });
    if (!error) return null;
    if (/rate limit|security purposes|too many/i.test(error.message)) {
      return 'Please wait before requesting another code.';
    }
    return 'Could not resend the code. Please try again.';
  } catch {
    return 'Unable to connect. Check your internet connection and try again.';
  }
}

export default function VerifyScreen() {
  const { colors, isDark } = useTheme();
  const styles = getVerifyStyles(colors);
  const router = useRouter();
  const { verifySignupOtp } = useAuth();
  const { attemptId, email, flow } = useLocalSearchParams<{
    attemptId?: string;
    email: string;
    flow?: string;
  }>();
  const signupFlow = flow === 'staff' ? 'staff' : 'merchant';
  const [code, setCode] = useState(() => OTP_KEYS.map(() => ''));
  const [focusedOtpIndex, setFocusedOtpIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [timer, setTimer] = useState(30);
  const inputs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => {
      setTimer((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [timer]);

  if (typeof email !== 'string' || !email.trim()) {
    return <Redirect href="/(auth)/login" />;
  }

  const focusOtpInput = (index: number) => {
    inputs.current[index]?.focus();
    setFocusedOtpIndex(index);
  };

  const handleCodeChange = (text: string, index: number) => {
    const digit = text.replace(/\D/g, '').slice(-1);
    setCode((previous) =>
      previous.map((value, currentIndex) =>
        currentIndex === index ? digit : value
      )
    );
    if (digit && index < LAST_OTP_INDEX) {
      focusOtpInput(index + 1);
    }
  };

  const verifyOtp = async () => {
    if (isLoading) return;
    const token = code.join('');
    if (token.length !== OTP_KEYS.length) {
      Alert.alert('Error', 'Please enter a complete 6-digit code');
      return;
    }

    setIsLoading(true);
    const result = await verifySignupOtp(email, token, attemptId, signupFlow);
    setIsLoading(false);
    if (result.error || !result.sessionEstablished) {
      Alert.alert(
        'Verification Failed',
        result.error ??
          'Email verification did not finish. Request a new code and try again.'
      );
      return;
    }
    setShowSuccess(true);
  };

  const resendCode = async () => {
    if (timer > 0 || isLoading) return;
    setIsLoading(true);
    const error = await resendSignupOtp(email);
    setIsLoading(false);
    if (error) {
      Alert.alert('Could Not Resend Code', error);
      return;
    }
    Alert.alert('Sent', 'A new code has been sent to your email.');
    setTimer(60);
  };

  const handleOtpAccessoryNext = () => {
    if (focusedOtpIndex < LAST_OTP_INDEX) {
      focusOtpInput(focusedOtpIndex + 1);
      return;
    }
    void verifyOtp();
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <LinearGradient
        colors={[colors.background, colors.backgroundLight]}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.content}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.backButton,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a code to{' '}
            <Text style={{ color: colors.text, fontWeight: 'bold' }}>
              {email}
            </Text>
          </Text>
        </View>

        <View style={styles.otpContainer}>
          {OTP_KEYS.map((key, index) => (
            <TextInput
              accessibilityLabel={`Digit ${index + 1} of ${OTP_KEYS.length}`}
              autoComplete="one-time-code"
              keyboardType="number-pad"
              key={key}
              maxLength={1}
              onChangeText={(text) => handleCodeChange(text, index)}
              onFocus={() => setFocusedOtpIndex(index)}
              onKeyPress={({ nativeEvent }) => {
                if (
                  nativeEvent.key === 'Backspace' &&
                  !code[index] &&
                  index > 0
                ) {
                  focusOtpInput(index - 1);
                }
              }}
              placeholder="-"
              placeholderTextColor={colors.textMuted}
              ref={(ref) => {
                inputs.current[index] = ref;
              }}
              returnKeyType="done"
              style={styles.otpInput}
              textContentType="oneTimeCode"
              value={code[index]}
            />
          ))}
        </View>

        <View style={styles.otpActionRow}>
          <Pressable
            accessibilityLabel="Previous code digit"
            accessibilityRole="button"
            accessibilityState={{ disabled: focusedOtpIndex === 0 }}
            disabled={focusedOtpIndex === 0}
            onPress={() => focusOtpInput(focusedOtpIndex - 1)}
            style={({ pressed }) => [
              styles.otpActionButton,
              focusedOtpIndex === 0 && styles.otpActionDisabled,
              pressed && focusedOtpIndex > 0 && styles.otpActionPressed,
            ]}
          >
            <Text style={styles.otpActionText}>Previous</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={
              focusedOtpIndex < LAST_OTP_INDEX
                ? 'Next code digit'
                : 'Verify code'
            }
            accessibilityRole="button"
            accessibilityState={{ busy: isLoading, disabled: isLoading }}
            disabled={isLoading}
            onPress={handleOtpAccessoryNext}
            style={({ pressed }) => [
              styles.otpActionPrimaryButton,
              pressed && !isLoading && styles.otpActionPressed,
            ]}
          >
            <Text style={styles.otpActionPrimaryText}>
              {focusedOtpIndex < LAST_OTP_INDEX ? 'Next' : 'Verify'}
            </Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityLabel="Verify Email"
          accessibilityRole="button"
          accessibilityState={{ busy: isLoading, disabled: isLoading }}
          disabled={isLoading}
          onPress={verifyOtp}
          style={({ pressed }) => [
            styles.button,
            isLoading && { opacity: 0.7 },
            pressed && !isLoading && { opacity: 0.7 },
          ]}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.textOnPrimary} />
          ) : (
            <Text style={styles.buttonText}>Verify Email</Text>
          )}
        </Pressable>

        <Pressable
          accessibilityLabel="Resend code"
          accessibilityRole="button"
          accessibilityState={{
            busy: isLoading,
            disabled: timer > 0 || isLoading,
          }}
          disabled={timer > 0 || isLoading}
          onPress={resendCode}
          style={styles.resendButton}
        >
          <Text
            style={[
              styles.resendText,
              timer > 0 && { color: colors.textMuted },
            ]}
          >
            {timer > 0 ? `Resend code in ${timer}s` : "I didn't receive a code"}
          </Text>
        </Pressable>
      </SafeAreaView>

      {showSuccess ? (
        <View style={[StyleSheet.absoluteFill, styles.successOverlay]}>
          <View style={styles.successCard}>
            <View style={styles.iconContainer}>
              <Ionicons
                color={colors.textOnPrimary}
                name="checkmark"
                size={40}
              />
            </View>
            <Text style={styles.successTitle}>Verified!</Text>
            <Text style={styles.successMessage}>
              Your account is ready. Continue to add your business details.
            </Text>
            <Pressable
              accessibilityLabel="Continue setup"
              accessibilityRole="button"
              onPress={() => router.replace('/(auth)/complete-profile')}
              style={styles.successButton}
            >
              <Text style={styles.successButtonText}>Continue setup</Text>
              <Ionicons
                color={colors.textOnPrimary}
                name="arrow-forward"
                size={20}
              />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
