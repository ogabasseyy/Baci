import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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
import {
  RADIUS,
  SPACING,
  type ThemeColors,
  TYPOGRAPHY,
} from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { getEmailError } from '@/lib/sanitize';
import { supabase } from '@/lib/supabase';

// Module-scope so the throw-in-try stays outside the component body
// (React Compiler cannot lower that statement yet).
async function requestPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'https://usebaci.com/update-password',
  });

  if (error) throw error;
}

export default function ForgotPasswordScreen() {
  const { colors, isDark } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleReset = () => {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    const trimmedEmail = email.trim();
    const emailError = getEmailError(trimmedEmail);
    if (emailError) {
      Alert.alert('Invalid Email', emailError);
      return;
    }

    setIsLoading(true);
    void requestPasswordReset(trimmedEmail)
      .then(() => {
        Alert.alert(
          'Check your email',
          `We have sent a password reset link to ${trimmedEmail}`,
          [{ text: 'Back to Login', onPress: () => router.back() }]
        );
      })
      .catch((error: unknown) => {
        console.error('Reset error:', error);
        Alert.alert(
          'Error',
          error instanceof Error ? error.message : 'Failed to send reset email'
        );
      })
      .finally(() => setIsLoading(false));
  };

  const styles = getStyles(colors);

  return (
    <View style={styles.container}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      <LinearGradient
        colors={
          isDark
            ? [colors.background, colors.backgroundLight]
            : [colors.cardHover, colors.backgroundLight]
        }
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.content}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backButton,
            pressed && { opacity: 0.7 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Back to login"
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>

        <View style={styles.header}>
          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter your email to receive reset instructions.
          </Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email Address</Text>
            <TextInput
              accessibilityLabel="Email Address"
              style={styles.input}
              placeholder="your@email.com"
              placeholderTextColor={colors.placeholder}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={handleReset}
            />
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.button,
              isLoading && { opacity: 0.7 },
              pressed && !isLoading && { opacity: 0.7 },
            ]}
            onPress={handleReset}
            disabled={isLoading}
            accessibilityRole="button"
            accessibilityLabel={
              isLoading ? 'Sending instructions...' : 'Send Instructions'
            }
            accessibilityState={{ disabled: isLoading, busy: isLoading }}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.buttonText}>Send Instructions</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const getStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flex: 1,
      padding: SPACING.lg,
    },
    backButton: {
      marginBottom: SPACING.lg,
    },
    header: {
      marginBottom: SPACING.xl,
    },
    title: {
      fontSize: TYPOGRAPHY.size['3xl'],
      fontFamily: TYPOGRAPHY.fontFamily.bold,
      color: colors.text,
      marginBottom: SPACING.sm,
    },
    subtitle: {
      fontSize: TYPOGRAPHY.size.md,
      color: colors.textSecondary,
      lineHeight: TYPOGRAPHY.size.md * TYPOGRAPHY.lineHeight.relaxed,
    },
    form: {
      gap: SPACING.lg,
    },
    inputGroup: {
      gap: SPACING.xs,
    },
    label: {
      color: colors.text,
      fontSize: TYPOGRAPHY.size.sm,
      fontFamily: TYPOGRAPHY.fontFamily.medium,
    },
    input: {
      backgroundColor: colors.inputBg,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: RADIUS.md,
      padding: SPACING.md,
      color: colors.text,
      fontSize: TYPOGRAPHY.size.md,
    },
    button: {
      backgroundColor: colors.primary,
      paddingVertical: SPACING.lg,
      borderRadius: RADIUS.full,
      alignItems: 'center',
      marginTop: SPACING.md,
    },
    buttonText: {
      color: colors.textOnPrimary,
      fontSize: TYPOGRAPHY.size.lg,
      fontFamily: TYPOGRAPHY.fontFamily.bold,
    },
  });
