import Ionicons from '@react-native-vector-icons/ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { getMerchantSetupStyles } from '@/components/auth/register/merchant-setup.styles';
import { RegisterAccountStep } from '@/components/auth/register/RegisterAccountStep';
import { getStyles } from '@/components/auth/register/register.styles';
import { AppFormScreen } from '@/components/ui/AppFormScreen';
import { useAuth } from '@/hooks/useAuth';
import { useLightNavigationBar } from '@/hooks/useLightNavigationBar';
import { useTheme } from '@/hooks/useTheme';
import {
  type PasswordValidationResult,
  validatePassword,
} from '@/lib/password-utils';
import { getEmailError } from '@/lib/sanitize';

interface AccountFormData {
  email: string;
  password: string;
  confirmPassword: string;
  firstName: string;
  lastName: string;
}

const INITIAL_FORM: AccountFormData = {
  email: '',
  password: '',
  confirmPassword: '',
  firstName: '',
  lastName: '',
};

const INITIAL_PASSWORD_STATE: PasswordValidationResult = {
  isValid: false,
  strength: 0,
  requirements: {
    length: false,
    complexity: false,
    notCommon: false,
    match: true,
  },
};

export default function RegisterScreen() {
  const { colors, isDark } = useTheme();
  const styles = getStyles(colors);
  const setupStyles = getMerchantSetupStyles(colors);
  const router = useRouter();
  const { signUp } = useAuth();
  const submissionLocked = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState<AccountFormData>(INITIAL_FORM);
  const [passwordState, setPasswordState] = useState<PasswordValidationResult>(
    INITIAL_PASSWORD_STATE
  );
  const [confirmError, setConfirmError] = useState<string | null>(null);
  useLightNavigationBar(isDark);

  const updateForm = <K extends keyof AccountFormData>(
    key: K,
    value: AccountFormData[K]
  ) => {
    if (key === 'password') {
      setPasswordState(validatePassword(value, formData.confirmPassword));
      setConfirmError(
        formData.confirmPassword && value !== formData.confirmPassword
          ? 'Passwords do not match'
          : null
      );
    }
    if (key === 'confirmPassword') {
      setConfirmError(
        formData.password && value !== formData.password
          ? 'Passwords do not match'
          : null
      );
    }
    setFormData((previous) => ({ ...previous, [key]: value }));
  };

  const validateAccount = (): string | null => {
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      return 'Please enter your first and last name';
    }
    if (!formData.email || !formData.password || !formData.confirmPassword) {
      return 'Please fill in all fields';
    }
    const emailError = getEmailError(formData.email.trim());
    if (emailError) {
      return emailError;
    }
    const result = validatePassword(
      formData.password,
      formData.confirmPassword
    );
    if (!result.isValid) {
      return result.error || 'Please choose a stronger password.';
    }
    return null;
  };

  const handleNext = async () => {
    if (submissionLocked.current) {
      return;
    }
    const validationError = validateAccount();
    if (validationError) {
      Alert.alert('Check Your Details', validationError);
      return;
    }

    submissionLocked.current = true;
    setIsSubmitting(true);
    const email = formData.email.trim().toLowerCase();
    const firstName = formData.firstName.trim();
    const lastName = formData.lastName.trim();

    try {
      const result = await signUp({
        email,
        password: formData.password,
        firstName,
        lastName,
        fullName: `${firstName} ${lastName}`,
        signupFlow: 'merchant',
      });

      if (result.error) {
        Alert.alert('Sign Up Failed', result.error);
        return;
      }
      if (result.accountExists) {
        Alert.alert(
          'Account Exists',
          'An account with this email already exists. Please sign in instead.',
          [
            {
              text: 'Sign In',
              onPress: () => router.replace('/(auth)/login'),
            },
            { text: 'Cancel', style: 'cancel' },
          ]
        );
        return;
      }
      if (result.needsEmailConfirmation) {
        const attemptIdQuery = result.signupAttemptId
          ? `&attemptId=${encodeURIComponent(result.signupAttemptId)}`
          : '';
        router.replace(
          `/(auth)/verify?email=${encodeURIComponent(email)}${attemptIdQuery}&flow=merchant`
        );
        return;
      }
      if (result.sessionEstablished) {
        router.replace('/(auth)/complete-profile');
        return;
      }

      Alert.alert(
        'Sign Up Failed',
        'We could not establish your session. Please try again.'
      );
    } catch {
      Alert.alert(
        'Sign Up Failed',
        'Unable to connect. Please check your internet connection.'
      );
    } finally {
      submissionLocked.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />
      {isDark ? (
        <LinearGradient
          colors={['#0D0D1A', '#1A1A2E']}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      <AppFormScreen
        contentContainerStyle={styles.content}
        header={
          <View style={styles.header}>
            <View style={setupStyles.headerBrand}>
              <Pressable
                accessibilityLabel="Back"
                accessibilityRole="button"
                onPress={() => router.back()}
                style={setupStyles.headerMark}
              >
                <Ionicons color={colors.primary} name="arrow-back" size={20} />
              </Pressable>
              <Text style={styles.headerTitle}>Create Account</Text>
            </View>
            <Text style={setupStyles.headerMeta}>About 2 min</Text>
          </View>
        }
        style={styles.safeArea}
      >
        <RegisterAccountStep
          confirmError={confirmError}
          formData={formData}
          isLoading={isSubmitting}
          onNext={handleNext}
          passwordState={passwordState}
          showPassword={showPassword}
          updateForm={updateForm}
          onTogglePassword={() => setShowPassword((previous) => !previous)}
        />
      </AppFormScreen>
    </View>
  );
}
