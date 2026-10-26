import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, type TextInput } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { LoginAuthMethod } from '@/components/auth/LoginEmailStep';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useKeyboard } from '@/hooks/use-keyboard';
import { createLogger } from '@/lib/logger';
import { useAuthStore } from '@/stores/auth-store';
import {
  getAuthLoginResumeState,
  saveAuthLoginResumeState,
} from './login-resume-state';
import {
  type AuthStep,
  dismissAuthenticatedLogin,
  getValidatedLoginEmailHint,
  getValidatedLoginMode,
  loadLoginEmailHintFromReturnTo,
  normalizeEmail,
  returnToEmailFromAuthStep,
  validateLoginEmailInput,
} from './login-screen-controller.helpers';
import { runLoginSocialSignIn } from './login-social-sign-in';
import { useLoginAuthActions } from './use-login-auth-actions';
import { useLoginHardwareBackHandler } from './useLoginHardwareBackHandler';

const log = createLogger('Login');

export function useLoginScreenController() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const {
    email: emailParam,
    mode,
    returnTo,
  } = useLocalSearchParams<{
    email?: string;
    mode?: string;
    returnTo?: string;
  }>();
  const resumeReturnTo = returnTo ?? null;
  const validatedMode = getValidatedLoginMode(mode);
  const initialEmail = getValidatedLoginEmailHint(emailParam);

  const dismissAndNavigate = () => dismissAuthenticatedLogin(returnTo);
  const { signInWithOtp, verifyOtp, signInWithPassword } =
    useLoginAuthActions();

  const { signInWithGoogle, isLoading, signInWithApple, user, isInitialized } =
    useAuthStore(
      useShallow((state) => ({
        signInWithGoogle: state.signInWithGoogle,
        isLoading: state.isLoading,
        signInWithApple: state.signInWithApple,
        user: state.user,
        isInitialized: state.isInitialized,
      }))
    );

  const [step, setStep] = useState<AuthStep>('email');
  const [authMethod, setAuthMethod] = useState<LoginAuthMethod>('otp');
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isAppleLoading, setIsAppleLoading] = useState(false);
  const [email, setEmail] = useState(initialEmail);
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [_isAppleAvailable, setIsAppleAvailable] = useState(false);

  const { withKeyboardDismiss } = useKeyboard();

  const otpInputRef = useRef<TextInput>(null);
  const isMountedRef = useRef(true);
  const isVerifyingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isInitialized && user) {
      dismissAuthenticatedLogin(returnTo);
    }
  }, [isInitialized, user, returnTo]);

  useEffect(() => {
    return loadLoginEmailHintFromReturnTo({
      currentEmail: email,
      initialEmail,
      onError: (error) =>
        log.warn('Failed to load receipt claim email hint', error),
      returnTo,
      setEmail,
    });
  }, [email, initialEmail, returnTo]);

  useEffect(() => {
    if (validatedMode !== 'otp') {
      return;
    }

    let isActive = true;

    getAuthLoginResumeState(resumeReturnTo)
      .then((resumeState) => {
        if (!(isActive && resumeState)) {
          return;
        }

        setEmail(resumeState.email);
        setStep('otp');
        setOtp('');
        setOtpError(null);
      })
      .catch((error) => {
        log.warn('Failed to restore pending OTP login state', error);
      });

    return () => {
      isActive = false;
    };
  }, [validatedMode, resumeReturnTo]);

  useEffect(() => {
    if (step !== 'otp') {
      return;
    }

    const animationFrameId = requestAnimationFrame(() => {
      otpInputRef.current?.focus();
    });

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [step]);

  const handleContinue = withKeyboardDismiss(async () => {
    const { error, normalizedEmail } = validateLoginEmailInput(email);

    if (error) {
      setEmailError(error);
      return;
    }

    setEmailError(null);

    if (authMethod === 'otp') {
      const result = await signInWithOtp(normalizedEmail);
      if (result.success) {
        await saveAuthLoginResumeState({
          email: normalizedEmail,
          returnTo: resumeReturnTo,
          step: 'otp',
        });
        setEmail(normalizedEmail);
        setStep('otp');
        router.setParams({ mode: 'otp' });
      } else {
        Alert.alert(
          'Error',
          result.error || 'Failed to send verification code'
        );
      }
    } else {
      setEmail(normalizedEmail);
      setStep('password');
    }
  });

  const handlePasswordSignIn = withKeyboardDismiss(async () => {
    if (!password) {
      setPasswordError('Password is required');
      return;
    }

    const result = await signInWithPassword(normalizeEmail(email), password);

    if (result.success) {
      dismissAndNavigate();
    } else {
      Alert.alert('Error', result.error || 'Failed to sign in');
    }
  });

  const handleResendOtp = async () => {
    setOtp('');
    const normalizedEmail = normalizeEmail(email);
    const result = await signInWithOtp(normalizedEmail);

    if (result.success) {
      await saveAuthLoginResumeState({
        email: normalizedEmail,
        returnTo: resumeReturnTo,
        step: 'otp',
      });
      Alert.alert(
        'Success',
        'A new verification code has been sent to your email'
      );
      return true;
    } else {
      Alert.alert(
        'Error',
        result.error || 'Failed to resend verification code'
      );
      return false;
    }
  };

  const handleBack = () => {
    if (returnToEmailFromAuthStep(step, { setOtp, setPassword, setStep })) {
      return;
    }

    router.back();
  };

  useLoginHardwareBackHandler({
    setIsAppleAvailable,
    setOtp,
    setPassword,
    setStep,
    step,
  });

  const handleGoogleSignIn = async () => {
    await runLoginSocialSignIn({
      errorMessage: 'Failed to sign in with Google',
      loading: setIsGoogleLoading,
      log,
      provider: 'Google',
      signIn: signInWithGoogle,
    });
  };

  const handleAppleSignIn = async () => {
    await runLoginSocialSignIn({
      errorMessage: 'Failed to sign in with Apple',
      loading: setIsAppleLoading,
      log,
      provider: 'Apple',
      signIn: signInWithApple,
    });
  };

  return {
    authMethod,
    colorScheme,
    colors,
    dismissAndNavigate,
    email,
    emailError,
    handleAppleSignIn,
    handleBack,
    handleContinue,
    handleGoogleSignIn,
    handlePasswordSignIn,
    handleResendOtp,
    isAppleLoading,
    isGoogleLoading,
    isLoading,
    isMountedRef,
    isVerifyingRef,
    otp,
    otpError,
    otpInputRef,
    password,
    passwordError,
    setAuthMethod,
    setEmail,
    setEmailError,
    setOtp,
    setOtpError,
    setPassword,
    setPasswordError,
    setShowPassword,
    setStep,
    showPassword,
    signInWithOtp,
    step,
    verifyOtp,
  };
}
